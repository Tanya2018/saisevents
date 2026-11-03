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
