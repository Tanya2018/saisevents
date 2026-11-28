-- Step 10 (Nov 2026): Lead Hunter inside MatchMarket ("Find buyers" tab).
-- Members type what customers they want; the agent finds public business leads for them.
-- Credits: 5 free leads per company (once); VIP members get 50 leads each month; admins add bought packs.

-- 1. VIP flag, set by SAIS admins only.
create table if not exists public.member_plans (
  company_id uuid primary key references public.companies(id) on delete cascade,
  vip boolean not null default false,
  vip_since date,
  updated_at timestamptz not null default now()
);
alter table public.member_plans enable row level security;
drop policy if exists "read own plan" on public.member_plans;
create policy "read own plan" on public.member_plans for select to authenticated using (company_id = my_company() or is_admin());
drop policy if exists "admins manage plans" on public.member_plans;
create policy "admins manage plans" on public.member_plans for all to authenticated using (is_admin()) with check (is_admin());

-- 2. Credit ledger. Positive rows add leads (welcome, vip_month, pack), negative rows spend them.
create table if not exists public.lead_credits (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  amount int not null,
  reason text not null check (reason in ('welcome','vip_month','pack','spend','refund','adjust')),
  note text,
  period text, -- for vip_month grants, e.g. '2026-11'
  created_at timestamptz not null default now()
);
create unique index if not exists lead_credits_once on public.lead_credits (company_id, reason, coalesce(period,'')) where reason in ('welcome','vip_month');
alter table public.lead_credits enable row level security;
drop policy if exists "read own credits" on public.lead_credits;
create policy "read own credits" on public.lead_credits for select to authenticated using (company_id = my_company() or is_admin());
drop policy if exists "admins add credits" on public.lead_credits;
create policy "admins add credits" on public.lead_credits for insert to authenticated with check (is_admin());

-- 3. Searches members ask for. Written by the member-leads function, worked by member-leads-worker.
create table if not exists public.member_lead_searches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  query text not null,
  country text not null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  found int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists member_lead_searches_q on public.member_lead_searches (status, created_at);
alter table public.member_lead_searches enable row level security;
drop policy if exists "read own searches" on public.member_lead_searches;
create policy "read own searches" on public.member_lead_searches for select to authenticated using (company_id = my_company() or is_admin());

-- 4. The leads found for each member. Private to that member.
create table if not exists public.member_leads (
  id bigserial primary key,
  search_id uuid not null references public.member_lead_searches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  city text,
  country text,
  main_business text,
  fit_reason text,
  website text,
  email text,
  phone text,
  source_url text,
  created_at timestamptz not null default now()
);
create index if not exists member_leads_company on public.member_leads (company_id, created_at desc);
alter table public.member_leads enable row level security;
drop policy if exists "read own leads" on public.member_leads;
create policy "read own leads" on public.member_leads for select to authenticated using (company_id = my_company() or is_admin());

-- 5. Balance helper for the page and the functions.
create or replace function public.lead_balance(cid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount),0)::int from lead_credits
  where company_id = cid and (cid = my_company() or is_admin() or coalesce(auth.role(),'') = 'service_role');
$$;
revoke all on function public.lead_balance(uuid) from public, anon;
grant execute on function public.lead_balance(uuid) to authenticated, service_role;
