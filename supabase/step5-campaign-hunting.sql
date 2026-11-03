-- Step 5 (Nov 2026): the lead hunter works per campaign.
-- Each campaign gets: a hunting on/off switch, what to search for, which countries, and its registration page.
-- Switching hunting on creates the searches; switching it off pauses them. Nothing is deleted.
-- Safe to run more than once.

alter table public.campaigns add column if not exists hunting boolean not null default false;
alter table public.campaigns add column if not exists hunt_sectors text[] not null default '{}';
alter table public.campaigns add column if not exists hunt_countries text[] not null default '{}';
alter table public.campaigns add column if not exists register_url text;

-- Keep the search list in step with each campaign
create or replace function public.campaign_hunts_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.name is distinct from old.name then
    update lead_hunts set expo = new.name where expo = old.name;
    update leads set expo = new.name where expo = old.name;
  end if;
  if new.hunting then
    insert into lead_hunts (expo, sector, country)
    select new.name, s, c from unnest(new.hunt_sectors) s cross join unnest(new.hunt_countries) c
    where trim(s) <> '' and trim(c) <> ''
    on conflict (expo, sector, country) do update set active = true;
    update lead_hunts set active = false
    where expo = new.name and not (sector = any(new.hunt_sectors) and country = any(new.hunt_countries));
  else
    update lead_hunts set active = false where expo = new.name;
  end if;
  return new;
end $$;
drop trigger if exists campaigns_hunts_sync on public.campaigns;
create trigger campaigns_hunts_sync after insert or update of name, hunting, hunt_sectors, hunt_countries on public.campaigns
for each row execute function public.campaign_hunts_sync();

-- Registration pages on saisevents.com
update public.campaigns set register_url = 'https://saisevents.com/afroplast-2027.html#register' where name = 'AFROPLAST 2027' and register_url is null;
update public.campaigns set register_url = 'https://saisevents.com/agroexpo-2027.html#register' where name = 'AGROEXPO 2027' and register_url is null;
update public.campaigns set register_url = 'https://saisevents.com/aluminium-china-2027.html#register' where name = 'ALUMINIUM CHINA 2027' and register_url is null;
update public.campaigns set register_url = 'https://saisevents.com/ifco-2027.html#register' where name = 'IFCO 2027' and register_url is null;
update public.campaigns set register_url = 'https://saisevents.com/ie-expo-2027.html#register' where name = 'IE expo China 2027' and register_url is null;

-- AFROPLAST keeps hunting exactly what it hunts today
update public.campaigns c set
  hunt_sectors = coalesce((select array_agg(distinct sector order by sector) from lead_hunts where expo = c.name), '{}'),
  hunt_countries = coalesce((select array_agg(distinct country order by country) from lead_hunts where expo = c.name), '{}'),
  hunting = exists (select 1 from lead_hunts where expo = c.name and active)
where c.name = 'AFROPLAST 2027' and c.hunt_sectors = '{}';

-- Suggested searches for AGROEXPO and ALUMINIUM CHINA, left switched off until Kate turns them on
update public.campaigns set
  hunt_sectors = array['large commercial farms, flower and vegetable exporters','greenhouse and irrigation companies','agro dealers and farm machinery importers','dairy and poultry producers'],
  hunt_countries = array['Kenya','Uganda','Tanzania','Ethiopia','Rwanda']
where name = 'AGROEXPO 2027' and hunt_sectors = '{}';
update public.campaigns set
  hunt_sectors = array['aluminium extruders and fabricators','aluminium window, door and facade makers','metal importers and stockists','cable, packaging and solar companies that use aluminium or copper','metal recyclers'],
  hunt_countries = array['Kenya','Uganda','Tanzania','South Africa','Egypt','United Arab Emirates','Saudi Arabia']
where name = 'ALUMINIUM CHINA 2027' and hunt_sectors = '{}';
