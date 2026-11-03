-- SAIS Trade Market database setup. Run once in Supabase SQL Editor.

-- Companies: one per user account
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  city text,
  country text,
  role text not null check (role in ('Buyer','Importer','Exporter','Supplier','Manufacturer','Organiser','Service provider')),
  sells text,
  wants text,
  markets text,
  deal_size text,
  website text,
  whatsapp text,
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- AI matches: one row per company per suggested partner
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  for_company uuid not null references public.companies(id) on delete cascade,
  match_company uuid not null references public.companies(id) on delete cascade,
  score int not null check (score between 0 and 100),
  reason text not null,
  status text not null default 'new' check (status in ('new','contacted','passed')),
  created_at timestamptz not null default now(),
  unique (for_company, match_company)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_a uuid not null references public.companies(id) on delete cascade,
  company_b uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (company_a < company_b),
  unique (company_a, company_b)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_company uuid references public.companies(id) on delete set null,
  kind text not null default 'user' check (kind in ('user','agent')),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  from_company uuid not null references public.companies(id) on delete cascade,
  to_company uuid not null references public.companies(id) on delete cascade,
  starts_at timestamptz not null,
  meeting_type text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','declined')),
  created_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  seller_company uuid not null references public.companies(id) on delete cascade,
  buyer_company uuid not null references public.companies(id) on delete cascade,
  title text not null,
  discount numeric not null default 0 check (discount between 0 and 50),
  stage text not null default 'Proposed' check (stage in ('Proposed','Negotiating','Accepted','Delivered')),
  created_at timestamptz not null default now()
);

create table public.deal_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  name text not null,
  qty numeric not null check (qty > 0),
  unit_price numeric not null check (unit_price >= 0)
);

create table public.deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  actor_company uuid references public.companies(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);

create index on public.matches (for_company);
create index on public.messages (conversation_id, created_at);
create index on public.meetings (from_company);
create index on public.meetings (to_company);
create index on public.deals (seller_company);
create index on public.deals (buyer_company);

-- Helper checks
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select id from companies where owner = auth.uid();
$$;

create or replace function public.i_am_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies where owner = auth.uid() and status = 'approved');
$$;

create or replace function public.in_conversation(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversations c where c.id = conv and my_company() in (c.company_a, c.company_b));
$$;

create or replace function public.in_deal(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from deals x where x.id = d and my_company() in (x.seller_company, x.buyer_company));
$$;

-- Members cannot approve themselves
create or replace function public.guard_company_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.status := 'pending';
    elsif new.status is distinct from old.status then new.status := old.status;
    end if;
  end if;
  return new;
end $$;
create trigger companies_guard before insert or update on public.companies
for each row execute function public.guard_company_status();

-- Row level security
alter table public.companies enable row level security;
alter table public.admins enable row level security;
alter table public.matches enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.meetings enable row level security;
alter table public.deals enable row level security;
alter table public.deal_items enable row level security;
alter table public.deal_events enable row level security;

create policy "see approved, own, or all if admin" on public.companies for select to authenticated
  using (status = 'approved' or owner = auth.uid() or is_admin());
create policy "create own company" on public.companies for insert to authenticated
  with check (owner = auth.uid());
create policy "edit own company or admin" on public.companies for update to authenticated
  using (owner = auth.uid() or is_admin()) with check (owner = auth.uid() or is_admin());

create policy "admins see admins" on public.admins for select to authenticated using (user_id = auth.uid() or is_admin());

create policy "see my matches" on public.matches for select to authenticated
  using (for_company = my_company() or is_admin());
create policy "update my matches" on public.matches for update to authenticated
  using (for_company = my_company()) with check (for_company = my_company());

create policy "see my conversations" on public.conversations for select to authenticated
  using (my_company() in (company_a, company_b) or is_admin());
create policy "start conversation" on public.conversations for insert to authenticated
  with check (i_am_approved() and my_company() in (company_a, company_b));

create policy "read messages" on public.messages for select to authenticated
  using (in_conversation(conversation_id) or is_admin());
create policy "send messages" on public.messages for insert to authenticated
  with check (i_am_approved() and kind = 'user' and sender_company = my_company() and in_conversation(conversation_id));

create policy "see my meetings" on public.meetings for select to authenticated
  using (my_company() in (from_company, to_company) or is_admin());
create policy "request meeting" on public.meetings for insert to authenticated
  with check (i_am_approved() and from_company = my_company() and status = 'pending');
create policy "answer meeting" on public.meetings for update to authenticated
  using (my_company() in (from_company, to_company)) with check (my_company() in (from_company, to_company));

create policy "see my deals" on public.deals for select to authenticated
  using (my_company() in (seller_company, buyer_company) or is_admin());
create policy "open deal" on public.deals for insert to authenticated
  with check (i_am_approved() and my_company() in (seller_company, buyer_company));
create policy "update deal" on public.deals for update to authenticated
  using (my_company() in (seller_company, buyer_company)) with check (my_company() in (seller_company, buyer_company));

create policy "see deal items" on public.deal_items for select to authenticated using (in_deal(deal_id) or is_admin());
create policy "add deal items" on public.deal_items for insert to authenticated with check (in_deal(deal_id));
create policy "edit deal items" on public.deal_items for update to authenticated using (in_deal(deal_id)) with check (in_deal(deal_id));
create policy "remove deal items" on public.deal_items for delete to authenticated using (in_deal(deal_id));

create policy "see deal history" on public.deal_events for select to authenticated using (in_deal(deal_id) or is_admin());
create policy "add deal history" on public.deal_events for insert to authenticated
  with check (in_deal(deal_id) and actor_company = my_company());

-- Live chat updates
alter publication supabase_realtime add table public.messages;

-- Admin list of every account with email and company (added 26 Oct 2026)
create or replace function public.admin_users()
returns table(user_id uuid, email text, created_at timestamptz, company text, status text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.created_at, c.name, c.status
  from auth.users u left join public.companies c on c.owner = u.id
  where public.is_admin()
  order by u.created_at desc;
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;

-- Company profile uploads (added 26 Oct 2026)
alter table public.companies add column if not exists profile_file text;
insert into storage.buckets (id, name, public, file_size_limit)
values ('company-profiles', 'company-profiles', false, 10485760)
on conflict (id) do nothing;
create policy "upload own company profile" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-profiles' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "update own company profile" on storage.objects for update to authenticated
  using (bucket_id = 'company-profiles' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "delete own company profile" on storage.objects for delete to authenticated
  using (bucket_id = 'company-profiles' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "members read company profiles" on storage.objects for select to authenticated
  using (bucket_id = 'company-profiles');

-- Joint Venture Programme flag (added 27 Oct 2026)
alter table public.companies add column if not exists jv_open boolean not null default false;

-- Expos each company wants to attend (added 28 Oct 2026)
alter table public.companies add column if not exists expos text[] not null default '{}';


-- Public directory (run once). Shows only vetted companies that allow it, with no contact details.
alter table public.companies add column if not exists public_listing boolean not null default true;
create or replace function public.public_directory()
returns table(id uuid, name text, role text, city text, country text, sells text, wants text, markets text, expos text[], jv_open boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.role, c.city, c.country,
    regexp_replace(regexp_replace(regexp_replace(coalesce(c.sells,''), '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[contact hidden]', 'g'), '(https?://|www\.)(?!saisevents\.com)[^[:space:]]+', '[link hidden]', 'gi'), '\+?[0-9][0-9 ()-]{7,}[0-9]', '[contact hidden]', 'g'),
    regexp_replace(regexp_replace(regexp_replace(coalesce(c.wants,''), '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[contact hidden]', 'g'), '(https?://|www\.)(?!saisevents\.com)[^[:space:]]+', '[link hidden]', 'gi'), '\+?[0-9][0-9 ()-]{7,}[0-9]', '[contact hidden]', 'g'),
    c.markets, c.expos, c.jv_open
  from companies c
  where c.status = 'approved' and c.public_listing
  order by (c.role = 'Organiser') desc, c.created_at desc
  limit 500;
$$;
grant execute on function public.public_directory() to anon, authenticated;

-- AI agent: vetting notes, admins only (Nov 2026)
create table if not exists public.company_reviews (
  company_id uuid primary key references public.companies(id) on delete cascade,
  score int check (score between 0 and 100),
  verdict text check (verdict in ('approve','review','decline')),
  note text,
  checked_at timestamptz,
  matched_at timestamptz
);
alter table public.company_reviews enable row level security;
drop policy if exists "admins read reviews" on public.company_reviews;
create policy "admins read reviews" on public.company_reviews for select to authenticated using (is_admin());


-- Hide phone numbers and emails in member chats (Nov 2026). SAIS shares contacts once a deal is confirmed.
create or replace function public.mask_message_contacts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'user' and not is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    new.body := regexp_replace(new.body, '[A-Za-z0-9._%+-]+@(?!saisevents\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contact hidden]', 'g');
    new.body := regexp_replace(new.body, '(wa\.me|api\.whatsapp\.com|t\.me)/\S+', '[contact hidden]', 'gi');
    new.body := regexp_replace(new.body, '\+?[0-9](?:[ ().-]?[0-9]){8,}', '[contact hidden]', 'g');
  end if;
  return new;
end $$;
drop trigger if exists messages_mask on public.messages;
create trigger messages_mask before insert or update on public.messages
for each row execute function public.mask_message_contacts();
-- AI lead hunter (Nov 2026). Admins only. The agent writes here with the service role key.

-- 1. The list of searches the agent works through, one per run.
create table if not exists public.lead_hunts (
  id bigserial primary key,
  expo text not null,
  sector text not null,
  country text not null,
  active boolean not null default true,
  last_run_at timestamptz,
  found int not null default 0,
  unique (expo, sector, country)
);

-- 2. The companies the agent finds.
create table if not exists public.leads (
  id bigserial primary key,
  name text not null,
  name_key text not null unique,
  country text,
  city text,
  sector text,
  expo text,
  makes text,
  fit_reason text,
  score int check (score between 0 and 100),
  website text,
  phone text,
  email text,
  source_url text,
  status text not null default 'new' check (status in ('new','called','interested','registered','not_interested')),
  hunt_id bigint references public.lead_hunts(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.lead_hunts enable row level security;
alter table public.leads enable row level security;
drop policy if exists "admins manage hunts" on public.lead_hunts;
create policy "admins manage hunts" on public.lead_hunts for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admins manage leads" on public.leads;
create policy "admins manage leads" on public.leads for all to authenticated using (is_admin()) with check (is_admin());

-- 3. First hunt: AFROPLAST 2027 buyers across East Africa.
insert into public.lead_hunts (expo, sector, country)
select 'AFROPLAST 2027', s, c
from unnest(array[
  'plastic product manufacturers (injection, blow moulding, extrusion)',
  'packaging converters (film, sacks, bottles, preforms, labels)',
  'cosmetics and personal care manufacturers',
  'food and drink manufacturers that pack in plastic',
  'plastic recyclers'
]) s
cross join unnest(array['Kenya','Uganda','Tanzania','Ethiopia','Rwanda']) c
on conflict do nothing;

-- Lead hunter step 2: 7am list (Nov 2026)
alter table public.leads add column if not exists digest_sent_at timestamptz;
-- Step 1: lock WhatsApp numbers (Nov 2026).
-- Before: any signed-in member could read every approved company's WhatsApp number through the API.
-- After: numbers live in company_private. Only the company's own owner and SAIS admins can read them.
-- The app keeps writing whatsapp on companies as before; a trigger moves it across and blanks the public column.
-- Safe to run more than once.

-- 1. Private table, one row per company
create table if not exists public.company_private (
  company_id uuid primary key references public.companies(id) on delete cascade deferrable initially deferred,
  whatsapp text,
  updated_at timestamptz not null default now()
);
alter table public.company_private enable row level security;
drop policy if exists "owner or admin reads private" on public.company_private;
create policy "owner or admin reads private" on public.company_private for select to authenticated
  using (company_id = my_company() or is_admin());
-- No insert, update or delete policies: only the trigger below (and the service role) writes here.

-- 2. Trigger: move any whatsapp value written to companies into company_private
--    null    = not sent in this update (e.g. admin approving), keep the stored number
--    ''      = member cleared the number, store null
--    a value = store it
create or replace function public.move_whatsapp_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.whatsapp is not null then
    insert into company_private (company_id, whatsapp, updated_at)
    values (new.id, nullif(trim(new.whatsapp), ''), now())
    on conflict (company_id) do update set whatsapp = excluded.whatsapp, updated_at = now();
    new.whatsapp := null;
  end if;
  return new;
end $$;
drop trigger if exists companies_whatsapp_private on public.companies;
create trigger companies_whatsapp_private before insert or update on public.companies
for each row execute function public.move_whatsapp_private();

-- 3. Move the numbers that are already stored, then blank the public column
insert into public.company_private (company_id, whatsapp)
select id, nullif(trim(whatsapp), '') from public.companies where whatsapp is not null
on conflict (company_id) do update set whatsapp = excluded.whatsapp, updated_at = now();
update public.companies set whatsapp = null where whatsapp is not null;
-- Step 2: event campaigns (Nov 2026). One row per expo contract. Admins only.
-- Safe to run more than once: existing campaigns are never overwritten.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  organiser text,
  city text,
  country text,
  venue text,
  starts_on date,
  ends_on date,
  status text not null default 'recruiting' check (status in ('planning','recruiting','closed','done')),
  target_delegates int check (target_delegates is null or target_delegates >= 0),
  buyer_criteria text,
  hosted_benefits text,
  fee_per_delegate numeric check (fee_per_delegate is null or fee_per_delegate >= 0),
  fee_currency text not null default 'USD',
  report_day text,
  registration_deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
drop policy if exists "admins manage campaigns" on public.campaigns;
create policy "admins manage campaigns" on public.campaigns for all to authenticated
  using (is_admin()) with check (is_admin());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists campaigns_touch on public.campaigns;
create trigger campaigns_touch before update on public.campaigns
for each row execute function public.touch_updated_at();

-- Starting campaigns, from the signed contracts and organiser emails in the project notes.
-- Blank fields were not confirmed. Fill them in from the admin page.
insert into public.campaigns (name, organiser, city, country, venue, starts_on, ends_on, status, target_delegates, buyer_criteria, hosted_benefits, fee_per_delegate, report_day, registration_deadline, notes) values
('AFROPLAST 2027', null, 'Cairo', 'Egypt', 'Egypt International Exhibition Center', '2027-01-09', '2027-01-12', 'recruiting', null,
 'Plastics, packaging, rubber, non-woven and recycling buyers: manufacturers, converters, food and cosmetics packers from East Africa and the Middle East.',
 'Hotel for 3 days, airport and exhibition transfers, B2B matchmaking with exhibitors.',
 null, null, null, 'SAIS is regional exhibitor and delegate sourcing agent for East Africa and the Middle East.'),
('AGROEXPO 2027', 'Orion Fair', 'Izmir', 'Turkey', 'Fuar Izmir', '2027-02-02', '2027-02-06', 'recruiting', null,
 'Agriculture, greenhouse, irrigation, machinery and livestock buyers. Owners, directors and procurement managers. Must attend B2B meetings for 2 days and sign in.',
 '2 nights in a 3-star hotel, shuttle, VIP entry and lounge, Izmir Bay dinner cruise, B2B meetings. Buyers pay their own flights.',
 100, 'Friday', '2026-12-18', 'USD 100 per approved company. Tickets, tax certificate and chamber or business registration due to Orion by 18 Dec 2026. Weekly report every Friday until 21 Jan 2027. Exclusivity: no other agriculture show in Turkey until AGROEXPO ends.'),
('ALUMINIUM CHINA 2027', 'RX', 'Shanghai', 'China', 'Shanghai New International Expo Center', '2027-07-07', '2027-07-09', 'planning', 100,
 'GM, CEO, COO, CTO, VP, chief engineer, director, procurement, production or project manager from aluminium, copper, magnesium, metal recycling and downstream users (automotive, packaging, energy storage, appliances, electronics).',
 'Up to 3 nights hotel with breakfast, shuttle to venue, lunch vouchers on 7 and 8 July, airport pickup for groups of 10 or more, B2B matchmaking. No flights.',
 null, 'Weekly', null, 'Target: 50 from Africa and 50 from the Middle East. Visitor registration opens January 2027. SAIS proposed USD 300 per qualified delegate; not yet agreed in writing.'),
('IFCO 2027', 'ITKIB Fuarcilik', 'Istanbul', 'Turkey', 'Istanbul Expo Center', '2027-02-03', '2027-02-06', 'recruiting', null,
 'Apparel and fashion buyers, retailers and importers.',
 null, null, null, null, 'Hosted buyer recruitment partnership; terms to confirm.'),
('IE expo China 2027', null, 'Shanghai', 'China', 'Shanghai New International Expo Center', '2027-04-20', '2027-04-22', 'planning', 30,
 'Environmental technology buyers: water, waste, recycling, air and soil. Mostly East Africa.',
 null, null, null, null, 'Buyer delegation partnership in discussion; about 30 delegates proposed.')
on conflict (name) do nothing;
-- Step 3: one master list of businesses, plus named contacts (Nov 2026). Admins only.
-- Nothing is deleted. leads and companies keep working and each row gets a link (business_id) to its master record.
-- New leads and new member companies are linked automatically from now on.
-- Safe to run more than once.

-- 1. Same cleaning rule the lead hunter uses for company names
create or replace function public.biz_key(n text) returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(lower(coalesce(n, '')),
             '\m(ltd|limited|plc|co|company|group|industries|industry|products|enterprises|international|the)\M', '', 'g'),
           '[^a-z0-9]', '', 'g');
$$;
create or replace function public.web_domain(u text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(coalesce(u, ''), '^\s*(https?://)?(www\.)?([^/?#\s]+).*$', '\3')), '');
$$;

-- 2. Master businesses: one row per company per country
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null,
  country text,
  country_key text generated always as (coalesce(lower(trim(country)), '')) stored,
  city text,
  website text,
  domain text,
  sector text,
  makes text,
  phone text,
  email text,
  source text not null default 'manual' check (source in ('lead','member','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name_key, country_key)
);
create index if not exists businesses_domain on public.businesses (domain);

-- 3. Named people at a business (decision makers). Consent is recorded per person.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  full_name text not null,
  job_title text,
  phone text,
  email text,
  source_url text,
  consent_status text not null default 'not_asked'
    check (consent_status in ('not_asked','public_business_contact','given','refused','withdrawn')),
  consent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_business on public.contacts (business_id);

alter table public.businesses enable row level security;
alter table public.contacts enable row level security;
drop policy if exists "admins manage businesses" on public.businesses;
create policy "admins manage businesses" on public.businesses for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists "admins manage contacts" on public.contacts;
create policy "admins manage contacts" on public.contacts for all to authenticated using (is_admin()) with check (is_admin());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses for each row execute function public.touch_updated_at();
drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts for each row execute function public.touch_updated_at();

-- 4. Find or create the master record. Fills empty fields, never overwrites filled ones.
create or replace function public.ensure_business(p_name text, p_country text, p_city text, p_website text,
  p_sector text, p_makes text, p_phone text, p_email text, p_source text) returns uuid
language plpgsql security definer set search_path = public as $$
declare k text := biz_key(p_name); bid uuid;
begin
  if k = '' then return null; end if;
  insert into businesses (name, name_key, country, city, website, domain, sector, makes, phone, email, source)
  values (trim(p_name), k, nullif(trim(p_country), ''), nullif(trim(p_city), ''), nullif(trim(p_website), ''), web_domain(p_website),
          nullif(trim(p_sector), ''), nullif(trim(p_makes), ''), nullif(trim(p_phone), ''), nullif(trim(p_email), ''), p_source)
  on conflict (name_key, country_key) do update set
    city = coalesce(businesses.city, excluded.city),
    website = coalesce(businesses.website, excluded.website),
    domain = coalesce(businesses.domain, excluded.domain),
    sector = coalesce(businesses.sector, excluded.sector),
    makes = coalesce(businesses.makes, excluded.makes),
    phone = coalesce(businesses.phone, excluded.phone),
    email = coalesce(businesses.email, excluded.email)
  returning id into bid;
  return bid;
end $$;
revoke all on function public.ensure_business(text,text,text,text,text,text,text,text,text) from public, anon, authenticated;

-- 5. Links from the existing lists
alter table public.leads add column if not exists business_id uuid references public.businesses(id) on delete set null;
alter table public.companies add column if not exists business_id uuid references public.businesses(id) on delete set null;
create index if not exists leads_business on public.leads (business_id);
create index if not exists companies_business on public.companies (business_id);

-- 6. Keep new rows linked automatically
create or replace function public.link_lead_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.business_id := ensure_business(new.name, new.country, new.city, new.website, new.sector, new.makes, new.phone, new.email, 'lead');
  return new;
end $$;
drop trigger if exists leads_link_business on public.leads;
create trigger leads_link_business before insert or update of name, country on public.leads
for each row execute function public.link_lead_business();

-- Member companies: no phone or email copied (those stay private to the member and admins)
create or replace function public.link_company_business() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.business_id := ensure_business(new.name, new.country, new.city, new.website, new.role, new.sells, null, null, 'member');
  return new;
end $$;
drop trigger if exists companies_link_business on public.companies;
create trigger companies_link_business before insert or update of name, country on public.companies
for each row execute function public.link_company_business();

-- 7. Copy in everything that exists today
update public.leads set business_id = ensure_business(name, country, city, website, sector, makes, phone, email, 'lead')
where business_id is null;
update public.companies set business_id = ensure_business(name, country, city, website, role, sells, null, null, 'member')
where business_id is null;

-- 8. Possible duplicates for a person to check (never merged automatically)
create or replace view public.business_possible_duplicates with (security_invoker = true) as
  select 'same website' as reason, b.domain as shared, b.id, b.name, b.country, b.source
  from public.businesses b
  where b.domain is not null and (select count(*) from public.businesses x where x.domain = b.domain) > 1
  union all
  select 'same name, different country', b.name_key, b.id, b.name, b.country, b.source
  from public.businesses b
  where (select count(*) from public.businesses x where x.name_key = b.name_key) > 1
  order by 1, 2, 4;
-- Step 4: delegate applications (Nov 2026). One row per business per campaign. Admins only.
-- Fills itself from: leads found by the hunter (stage "found") and MatchMarket members who ticked an expo (stage "registered").
-- Adding a new campaign later also pulls in members who already ticked that expo.
-- Nothing existing is changed or deleted. Safe to run more than once.

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  stage text not null default 'found' check (stage in
    ('found','contacted','interested','not_interested','registered','submitted','approved','declined','attended')),
  source text not null default 'manual' check (source in ('hunter','matchmarket','form','whatsapp','manual')),
  checklist jsonb not null default '{}'::jsonb,
  ai_score int check (ai_score is null or ai_score between 0 and 100),
  ai_reasons text,
  ai_checked_at timestamptz,
  decision_at date,
  decision_note text,
  next_follow_up date,
  notes text,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, business_id)
);
create index if not exists applications_campaign on public.applications (campaign_id, stage);
create index if not exists applications_business on public.applications (business_id);

alter table public.applications enable row level security;
drop policy if exists "admins manage applications" on public.applications;
create policy "admins manage applications" on public.applications for all to authenticated using (is_admin()) with check (is_admin());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create or replace function public.application_stage_time() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  return new;
end $$;
drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications for each row execute function public.application_stage_time();

-- Stage order, used so automatic updates only ever move an application forward
create or replace function public.stage_rank(s text) returns int language sql immutable as $$
  select case s when 'found' then 1 when 'contacted' then 2 when 'interested' then 3 when 'not_interested' then 3
    when 'registered' then 4 when 'submitted' then 5 when 'approved' then 6 when 'declined' then 6 when 'attended' then 7 else 0 end;
$$;

-- Add or move forward one application. Never moves an application backwards.
create or replace function public.upsert_application(p_campaign uuid, p_business uuid, p_stage text, p_source text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_campaign is null or p_business is null then return; end if;
  insert into applications (campaign_id, business_id, stage, source) values (p_campaign, p_business, p_stage, p_source)
  on conflict (campaign_id, business_id) do update set stage = excluded.stage
    where stage_rank(applications.stage) < stage_rank(excluded.stage) and applications.stage not in ('not_interested','declined');
end $$;
revoke all on function public.upsert_application(uuid,uuid,text,text) from public, anon, authenticated;

-- Lead status words mapped to stages
create or replace function public.lead_stage(s text) returns text language sql immutable as $$
  select case s when 'called' then 'contacted' when 'interested' then 'interested' when 'registered' then 'registered'
    when 'not_interested' then 'not_interested' else 'found' end;
$$;

-- From leads: the lead's expo must match a campaign name exactly
create or replace function public.lead_to_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform upsert_application((select id from campaigns where name = new.expo), new.business_id, lead_stage(new.status), 'hunter');
  return new;
end $$;
drop trigger if exists leads_to_application on public.leads;
create trigger leads_to_application after insert or update of status, expo, business_id on public.leads
for each row execute function public.lead_to_application();

-- From MatchMarket members: every ticked expo that is a campaign becomes "registered"
create or replace function public.company_to_applications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.business_id is not null and coalesce(array_length(new.expos, 1), 0) > 0 then
    perform upsert_application(c.id, new.business_id, 'registered', 'matchmarket') from campaigns c where c.name = any(new.expos);
  end if;
  return new;
end $$;
drop trigger if exists companies_to_applications on public.companies;
create trigger companies_to_applications after insert or update of expos, business_id on public.companies
for each row execute function public.company_to_applications();

-- A new or renamed campaign pulls in what already matches it
create or replace function public.campaign_backfill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform upsert_application(new.id, l.business_id, lead_stage(l.status), 'hunter') from leads l where l.expo = new.name and l.business_id is not null;
  perform upsert_application(new.id, co.business_id, 'registered', 'matchmarket') from companies co where new.name = any(co.expos) and co.business_id is not null;
  return new;
end $$;
drop trigger if exists campaigns_backfill on public.campaigns;
create trigger campaigns_backfill after insert or update of name on public.campaigns
for each row execute function public.campaign_backfill();

-- Fill from everything that exists today
select upsert_application(c.id, l.business_id, lead_stage(l.status), 'hunter')
from leads l join campaigns c on c.name = l.expo where l.business_id is not null;
select upsert_application(c.id, co.business_id, 'registered', 'matchmarket')
from companies co join campaigns c on c.name = any(co.expos) where co.business_id is not null;
-- Step 4b (Nov 2026)
-- 1. Expo registration forms on saisevents.com save straight into the pipeline as "registered".
-- 2. Leads keep the hunter's score and reason on their application.
-- Passport details are never sent here; they stay in Netlify Forms only.
-- Safe to run more than once.

-- Called only by the Netlify form function with the service role key
create or replace function public.form_application(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; bid uuid; ctid uuid; aid uuid;
begin
  select id into cid from campaigns where name = p->>'campaign';
  if cid is null then return null; end if;
  bid := ensure_business(p->>'company', p->>'country', p->>'city', p->>'website', p->>'activities', p->>'products', null, null, 'manual');
  if bid is null then return null; end if;
  if coalesce(trim(p->>'contact_name'), '') <> '' then
    select id into ctid from contacts
      where business_id = bid and (lower(email) = lower(p->>'email') or lower(full_name) = lower(trim(p->>'contact_name'))) limit 1;
    if ctid is null then
      insert into contacts (business_id, full_name, job_title, phone, email, source_url, consent_status, consent_at)
      values (bid, trim(p->>'contact_name'), nullif(p->>'job_title', ''), nullif(p->>'whatsapp', ''), nullif(p->>'email', ''),
              'saisevents.com registration form',
              case when coalesce(p->>'consent', '') <> '' then 'given' else 'not_asked' end,
              case when coalesce(p->>'consent', '') <> '' then now() end)
      returning id into ctid;
    end if;
  end if;
  insert into applications (campaign_id, business_id, contact_id, stage, source, checklist)
  values (cid, bid, ctid, 'registered', 'form', coalesce(p->'answers', '{}'::jsonb))
  on conflict (campaign_id, business_id) do update set
    contact_id = coalesce(applications.contact_id, excluded.contact_id),
    checklist = applications.checklist || excluded.checklist,
    stage = case when stage_rank(applications.stage) < stage_rank('registered')
                  and applications.stage not in ('not_interested','declined') then 'registered' else applications.stage end,
    ai_checked_at = null
  returning id into aid;
  return aid;
end $$;
revoke all on function public.form_application(jsonb) from public, anon, authenticated;
grant execute on function public.form_application(jsonb) to service_role;

-- Hunter score and reason carried onto the application (only where none is set yet)
update public.applications a set ai_score = l.score, ai_reasons = l.fit_reason
from public.leads l join public.campaigns c on c.name = l.expo
where a.business_id = l.business_id and a.campaign_id = c.id and a.ai_score is null and l.score is not null;

create or replace function public.lead_to_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := (select id from campaigns where name = new.expo);
begin
  perform upsert_application(cid, new.business_id, lead_stage(new.status), 'hunter');
  if cid is not null and new.score is not null then
    update applications set ai_score = new.score, ai_reasons = new.fit_reason
    where campaign_id = cid and business_id = new.business_id and ai_score is null;
  end if;
  return new;
end $$;
-- Step 4c fix (Nov 2026): Organiser and Service provider profiles are never counted as delegates.
create or replace function public.company_to_applications() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role in ('Organiser','Service provider') then return new; end if;
  if new.business_id is not null and coalesce(array_length(new.expos, 1), 0) > 0 then
    perform upsert_application(c.id, new.business_id, 'registered', 'matchmarket') from campaigns c where c.name = any(new.expos);
  end if;
  return new;
end $$;

create or replace function public.campaign_backfill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform upsert_application(new.id, l.business_id, lead_stage(l.status), 'hunter') from leads l where l.expo = new.name and l.business_id is not null;
  perform upsert_application(new.id, co.business_id, 'registered', 'matchmarket') from companies co
    where new.name = any(co.expos) and co.business_id is not null and co.role not in ('Organiser','Service provider');
  return new;
end $$;

delete from public.applications a using public.companies co
where co.business_id = a.business_id and co.role in ('Organiser','Service provider') and a.source = 'matchmarket';
