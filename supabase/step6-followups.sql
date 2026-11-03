-- Step 6 (Nov 2026): activity notes, follow-up dates, weekly reports. Admins only.
-- Safe to run more than once.

alter table public.applications add column if not exists last_activity_at timestamptz;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null default 'note' check (kind in ('call','whatsapp','email','meeting','note')),
  body text not null check (length(body) between 1 and 4000),
  next_follow_up date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists activities_application on public.activities (application_id, created_at desc);
create index if not exists applications_follow_up on public.applications (next_follow_up) where next_follow_up is not null;

alter table public.activities enable row level security;
drop policy if exists "admins manage activities" on public.activities;
create policy "admins manage activities" on public.activities for all to authenticated using (is_admin()) with check (is_admin());

-- Logging an activity updates its application:
--   the follow-up date becomes the new one (or clears when none is given),
--   a call, WhatsApp, email or meeting moves a "found" company to "contacted".
create or replace function public.activity_to_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update applications set
    last_activity_at = new.created_at,
    next_follow_up = new.next_follow_up,
    stage = case when stage = 'found' and new.kind in ('call','whatsapp','email','meeting') then 'contacted' else stage end
  where id = new.application_id;
  return new;
end $$;
drop trigger if exists activities_to_application on public.activities;
create trigger activities_to_application after insert on public.activities
for each row execute function public.activity_to_application();
