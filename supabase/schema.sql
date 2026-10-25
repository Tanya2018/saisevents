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
