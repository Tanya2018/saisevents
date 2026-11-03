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
