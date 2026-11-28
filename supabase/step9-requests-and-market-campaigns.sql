-- Step 9 (Nov 2026): Requests board on MatchMarket, and enquiries for paid market campaigns.

-- 1. Requests board. Vetted members post what they need; other vetted members reply in chat.
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('buy','sell','meet','partner')),
  title text not null check (char_length(title) between 5 and 120),
  details text check (char_length(details) <= 1500),
  expo text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  expires_on date not null default (current_date + 60)
);
create index if not exists requests_open_idx on public.requests (status, created_at desc);
alter table public.requests enable row level security;

drop policy if exists "read requests" on public.requests;
create policy "read requests" on public.requests for select to authenticated
  using (is_admin() or company_id = my_company() or (i_am_approved() and status = 'open' and expires_on >= current_date));
drop policy if exists "post requests" on public.requests;
create policy "post requests" on public.requests for insert to authenticated
  with check (company_id = my_company() and i_am_approved());
drop policy if exists "edit own requests" on public.requests;
create policy "edit own requests" on public.requests for update to authenticated
  using (company_id = my_company() or is_admin()) with check (company_id = my_company() or is_admin());
drop policy if exists "delete own requests" on public.requests;
create policy "delete own requests" on public.requests for delete to authenticated
  using (company_id = my_company() or is_admin());

-- Contacts stay hidden on the board, same rule as chats.
create or replace function public.mask_request_contacts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    new.title := regexp_replace(new.title, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contact hidden]', 'g');
    new.title := regexp_replace(new.title, '\+?[0-9](?:[ ().-]?[0-9]){8,}', '[contact hidden]', 'g');
    new.details := regexp_replace(coalesce(new.details,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contact hidden]', 'g');
    new.details := regexp_replace(new.details, '(wa\.me|api\.whatsapp\.com|t\.me)/\S+', '[contact hidden]', 'gi');
    new.details := regexp_replace(new.details, '\+?[0-9](?:[ ().-]?[0-9]){8,}', '[contact hidden]', 'g');
  end if;
  return new;
end $$;
drop trigger if exists requests_mask on public.requests;
create trigger requests_mask before insert or update on public.requests
for each row execute function public.mask_request_contacts();

-- 2. Enquiries for paid market campaigns (Africa Market Entry, Africa Export).
-- Written only by the market-campaign Netlify function with the service role key. Admins read.
create table if not exists public.campaign_enquiries (
  id uuid primary key default gen_random_uuid(),
  campaign text not null check (campaign in ('entry','export')),
  company text not null,
  contact_name text not null,
  job_title text,
  email text not null,
  whatsapp text not null,
  country text not null,
  website text,
  products text not null,
  target_markets text,
  expos text,
  timeline text,
  budget text,
  message text,
  status text not null default 'new' check (status in ('new','contacted','proposal','won','lost')),
  created_at timestamptz not null default now()
);
alter table public.campaign_enquiries enable row level security;
drop policy if exists "admins manage campaign enquiries" on public.campaign_enquiries;
create policy "admins manage campaign enquiries" on public.campaign_enquiries for all to authenticated
  using (is_admin()) with check (is_admin());
