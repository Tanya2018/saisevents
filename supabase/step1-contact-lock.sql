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
