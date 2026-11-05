-- Step 8 (Nov 2026): website authenticity checks.
-- The agent stores a risk level and the red flags it found for every company.
-- Safe to run more than once.
alter table public.company_reviews add column if not exists risk text check (risk in ('low','medium','high'));
alter table public.company_reviews add column if not exists flags jsonb not null default '[]'::jsonb;
alter table public.company_reviews add column if not exists site_checked_at timestamptz;
