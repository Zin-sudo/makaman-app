-- The office is never a stranger, whichever way GoTrue writes the row.
--
-- 0046 exempts office-created accounts from the @makaman.ly rule and the five-a-day cap by
-- reading `created_by_office` out of raw_app_meta_data. The Edge Function sets that through
-- auth.admin.createUser({ app_metadata: ... }), and the trigger is AFTER INSERT — so the
-- exemption only works if GoTrue puts custom app_metadata in the INSERT rather than in a
-- follow-up UPDATE.
--
-- That could not be settled from the environment this was written in: outbound calls to
-- *.supabase.co are blocked there, so GoTrue could not be exercised. What the existing rows
-- do show is suggestive in the wrong direction — every account made through the admin API
-- has created_at <> confirmed_at, which means confirmation, at least, lands in a second
-- write. Assuming app_metadata behaves differently would be a guess, and the thing being
-- guessed about is whether the office can create an account on trial morning.
--
-- So the rule stops depending on it. Two independent reasons an office-created account is
-- not counted, and either one is enough:
--
--   1. the app_metadata flag, as before — correct if GoTrue writes it in the insert;
--   2. the account is already ACTIVE. A self-registration lands as 'pending' and stays
--      there until somebody in the office approves it; the create_technician path activates
--      the account in the same request that made it. So an office account stops counting
--      within milliseconds of existing, flag or no flag.
--
-- (2) also reads better as a rule than the thing it replaces. The cap exists to stop a
-- flood of strangers arriving through a leaked link, and an account somebody in the office
-- has already looked at and approved is not a stranger. Five UNAPPROVED sign-ups at a time
-- is the honest statement of what is being limited; a flood cannot get past it, and a real
-- technician joining on a busy day is no longer blocked by five earlier colleagues who were
-- approved hours ago.
--
-- The domain rule is untouched and was never at risk: an office-created account is an
-- @makaman.ly address and passes it either way.

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

    -- Counted off auth.users joined to the profile it produced, so there is one truth and
    -- nothing to keep in step with it. A row with no profile yet is counted: that is a
    -- sign-up mid-flight, and the safe direction is to count it.
    select count(*) into recent
      from auth.users u
      left join public.profiles p on p.id = u.id
     where u.created_at > now() - interval '24 hours'
       and u.id <> new.id
       and coalesce(u.raw_app_meta_data->>'created_by_office', '') <> 'true'
       and coalesce(p.status, 'pending') <> 'active';

    if recent >= 5 then
      raise exception 'Too many sign-ups waiting to be approved. Ask the office to create the account.'
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

-- 0037, 0044 and 0046 established the rule for every trigger function in this schema, and
-- CREATE OR REPLACE resets the ACL each time.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
