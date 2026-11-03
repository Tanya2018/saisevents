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
