-- Signing up is for the company, and there are only so many of us.
--
-- The sign-up link is a URL on a public Vercel domain. Nothing stopped a stranger who
-- came across it from creating an account — it would land as `pending` and the office
-- would have to notice and refuse it, which is a queue of strangers rather than a wall.
-- Two rules, both here in the database rather than only in the form:
--
--   1. Self-registration is limited to @makaman.ly addresses.
--   2. Five self-registrations in any rolling 24 hours.
--
-- A check in the sign-up form is a courtesy to the person typing, not a control: the same
-- request can be sent to /auth/v1/signup with curl and never see the form at all. The form
-- keeps its check because a readable message beats a database error, and this trigger is
-- what actually decides.
--
-- WHY app metadata and not user metadata for the office exemption
-- ---------------------------------------------------------------
-- Accounts the office creates through the admin-actions function are exempt: that path
-- already re-derives the caller from their own JWT and requires ops_manager or admin, and
-- the office must be able to create the eleventh technician on a busy day. It marks them
-- with `created_by_office` in APP metadata.
--
-- That column choice IS the security of the exemption. `raw_user_meta_data` is written
-- straight from the browser — `supabase.auth.signUp({ options: { data: {...} } })` puts
-- whatever the caller likes in it, so a rule that trusted it could be switched off by the
-- person it applies to. `raw_app_meta_data` can only be set through the admin API, which
-- needs the service-role key, which lives in the Edge Function's environment.
--
-- Every account that exists today was made by the office or seeded, so they are marked as
-- such below. Without that backfill the six accounts created this week would count against
-- the first day's cap and the office would find itself locked out of its own trial.
--
-- The raised message may not survive GoTrue's wrapper on its way back to the browser —
-- it tends to arrive as a generic "Database error saving new user". That is why the form
-- checks the domain too. The exception is not the message; it is the refusal.

update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                           || jsonb_build_object('created_by_office', true)
 where coalesce(raw_app_meta_data->>'created_by_office', '') <> 'true';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  by_office boolean := coalesce(new.raw_app_meta_data->>'created_by_office', '') = 'true';
  recent    integer;
begin
  if not by_office then
    if lower(coalesce(new.email, '')) !~ '@makaman\.ly$' then
      raise exception 'Sign-up is limited to @makaman.ly addresses.'
        using errcode = '42501';
    end if;

    -- Counted off auth.users rather than a counter table, so there is one truth and
    -- nothing to keep in step with it. `id <> new.id` makes this correct whether the
    -- trigger fires before or after the row lands.
    select count(*) into recent
      from auth.users u
     where u.created_at > now() - interval '24 hours'
       and coalesce(u.raw_app_meta_data->>'created_by_office', '') <> 'true'
       and u.id <> new.id;

    if recent >= 5 then
      raise exception 'Too many sign-ups in the last day. Ask the office to create the account.'
        using errcode = '42501';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'technician', 'pending');
  return new;
end;
$function$;

-- 0037 and 0044 established the rule for every other trigger function: a trigger function
-- is not an API endpoint. Re-asserted here because CREATE OR REPLACE resets the ACL.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
