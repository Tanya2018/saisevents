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
