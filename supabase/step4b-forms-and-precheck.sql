-- Step 4b (Nov 2026)
-- 1. Expo registration forms on saisevents.com save straight into the pipeline as "registered".
-- 2. Leads keep the hunter's score and reason on their application.
-- Passport details are never sent here; they stay in Netlify Forms only.
-- Safe to run more than once.

-- Called only by the Netlify form function with the service role key
create or replace function public.form_application(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; bid uuid; ctid uuid; aid uuid;
begin
  select id into cid from campaigns where name = p->>'campaign';
  if cid is null then return null; end if;
  bid := ensure_business(p->>'company', p->>'country', p->>'city', p->>'website', p->>'activities', p->>'products', null, null, 'manual');
  if bid is null then return null; end if;
  if coalesce(trim(p->>'contact_name'), '') <> '' then
    select id into ctid from contacts
      where business_id = bid and (lower(email) = lower(p->>'email') or lower(full_name) = lower(trim(p->>'contact_name'))) limit 1;
    if ctid is null then
      insert into contacts (business_id, full_name, job_title, phone, email, source_url, consent_status, consent_at)
      values (bid, trim(p->>'contact_name'), nullif(p->>'job_title', ''), nullif(p->>'whatsapp', ''), nullif(p->>'email', ''),
              'saisevents.com registration form',
              case when coalesce(p->>'consent', '') <> '' then 'given' else 'not_asked' end,
              case when coalesce(p->>'consent', '') <> '' then now() end)
      returning id into ctid;
    end if;
  end if;
  insert into applications (campaign_id, business_id, contact_id, stage, source, checklist)
  values (cid, bid, ctid, 'registered', 'form', coalesce(p->'answers', '{}'::jsonb))
  on conflict (campaign_id, business_id) do update set
    contact_id = coalesce(applications.contact_id, excluded.contact_id),
    checklist = applications.checklist || excluded.checklist,
    stage = case when stage_rank(applications.stage) < stage_rank('registered')
                  and applications.stage not in ('not_interested','declined') then 'registered' else applications.stage end,
    ai_checked_at = null
  returning id into aid;
  return aid;
end $$;
revoke all on function public.form_application(jsonb) from public, anon, authenticated;
grant execute on function public.form_application(jsonb) to service_role;

-- Hunter score and reason carried onto the application (only where none is set yet)
update public.applications a set ai_score = l.score, ai_reasons = l.fit_reason
from public.leads l join public.campaigns c on c.name = l.expo
where a.business_id = l.business_id and a.campaign_id = c.id and a.ai_score is null and l.score is not null;

create or replace function public.lead_to_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid := (select id from campaigns where name = new.expo);
begin
  perform upsert_application(cid, new.business_id, lead_stage(new.status), 'hunter');
  if cid is not null and new.score is not null then
    update applications set ai_score = new.score, ai_reasons = new.fit_reason
    where campaign_id = cid and business_id = new.business_id and ai_score is null;
  end if;
  return new;
end $$;
