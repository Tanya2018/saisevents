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
