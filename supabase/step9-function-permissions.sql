-- Step 9 (Nov 2026): lock down database function permissions.
-- Already applied to sais-trade-market on 10 November 2026 as migration "step9_function_permissions".
-- Triggers can no longer be called through the API, the "who am I" helpers are for signed-in users only,
-- and 6 functions get a fixed search path. public_directory stays public for directory.html.
-- The undo commands are kept outside the repo in C:\Users\USER\sais\audits\supabase-security-undo.sql.
-- Safe to run more than once.

-- A. Triggers: nobody calls these by name. They keep running automatically.
revoke execute on function
  public.activity_to_application(), public.application_stage_time(),
  public.campaign_backfill(), public.campaign_hunts_sync(),
  public.company_to_applications(), public.guard_company_status(),
  public.lead_to_application(), public.link_company_business(),
  public.link_lead_business(), public.mask_message_contacts(),
  public.move_whatsapp_private(), public.touch_updated_at()
from public, anon, authenticated;

-- B. Helpers: signed-in users only (the access rules need them).
revoke execute on function
  public.is_admin(), public.i_am_approved(), public.my_company(),
  public.house_company(), public.in_conversation(uuid), public.in_deal(uuid)
from public, anon;

-- C. public_directory and admin_users: no change.

-- D. Fixed search path on 6 functions.
alter function public.touch_updated_at()       set search_path = '';
alter function public.application_stage_time() set search_path = '';
alter function public.biz_key(text)            set search_path = '';
alter function public.web_domain(text)         set search_path = '';
alter function public.stage_rank(text)         set search_path = '';
alter function public.lead_stage(text)         set search_path = '';
