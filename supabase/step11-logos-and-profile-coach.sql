-- Step 11 (Nov 2026): company logos, and the profile coach agent.

-- 1. Company logos. Public images so every member can see them on cards.
alter table public.companies add column if not exists logo_url text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 1048576, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;
drop policy if exists "upload own logo" on storage.objects;
create policy "upload own logo" on storage.objects for insert to authenticated
  with check (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "update own logo" on storage.objects;
create policy "update own logo" on storage.objects for update to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "delete own logo" on storage.objects;
create policy "delete own logo" on storage.objects for delete to authenticated
  using (bucket_id = 'company-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Profile coach: what to fix, and how well each chosen expo fits the company.
-- Written by the profile-coach Netlify function with the service role key.
create table if not exists public.company_coach (
  company_id uuid primary key references public.companies(id) on delete cascade,
  expo_fit jsonb not null default '[]',   -- [{expo, fit: good|weak|poor, reason}]
  suggest jsonb not null default '[]',    -- [{expo, reason}] better expos they have not ticked
  todo text[] not null default '{}',      -- profile items to fix
  summary text,
  sig text,
  checked_at timestamptz,
  emailed_at timestamptz,
  emails int not null default 0
);
alter table public.company_coach enable row level security;
drop policy if exists "read own coach" on public.company_coach;
create policy "read own coach" on public.company_coach for select to authenticated using (company_id = my_company() or is_admin());
