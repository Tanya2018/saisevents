-- Step 7 (Nov 2026): SAIS team admins work as SAIS Events.
-- A team admin with no company of their own (for example Cindy) acts as the
-- house company, the company owned by the first admin (Kate's SAIS Events profile).
-- They then see the same Matches, Messages, Meetings and Deals as Kate.
-- Safe to run more than once.

create or replace function public.house_company() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from companies c join admins a on a.user_id = c.owner
  order by c.created_at limit 1;
$$;

create or replace function public.my_company() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from companies where owner = auth.uid()),
    (select house_company() where exists (select 1 from admins where user_id = auth.uid()))
  );
$$;

create or replace function public.i_am_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies where id = my_company() and status = 'approved');
$$;

-- Team admins are not "unfinished sign ups"
create or replace function public.admin_users()
returns table(user_id uuid, email text, created_at timestamptz, company text, status text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text, u.created_at,
         coalesce(c.name, case when exists (select 1 from public.admins a where a.user_id = u.id) then 'SAIS team' end),
         coalesce(c.status, case when exists (select 1 from public.admins a where a.user_id = u.id) then 'approved' end)
  from auth.users u left join public.companies c on c.owner = u.id
  where public.is_admin()
  order by u.created_at desc;
$$;
revoke all on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
