-- The office says who it is expecting, before it creates them.
--
-- 0046 and 0047 both tried to recognise an office-created account from the row GoTrue
-- writes, and both depend on something outside this schema's control:
--
--   0046 read `created_by_office` out of raw_app_meta_data, which only works if GoTrue puts
--        custom app_metadata in the INSERT rather than a follow-up UPDATE. That could not be
--        exercised from the environment this was written in — outbound calls to the auth
--        host are blocked there — and the existing rows point the wrong way: every account
--        made through the admin API has created_at <> confirmed_at, so at least one field
--        lands in a second write.
--   0047 added "already approved accounts do not count", which is a better rule and stays,
--        but does not cover this case. A PROBE proved it: with five sign-ups pending and the
--        flag not yet written, the office's own account was REFUSED. At the instant the
--        office's row is inserted its profile does not exist yet, so the exemption for
--        approved accounts is about the other rows, and the five pending ones still fill
--        the cap.
--
-- So the office stops being recognised and starts announcing itself. Before calling
-- createUser, admin-actions writes the address here with the service-role key. The trigger
-- looks for that note, and consumes it.
--
-- Why this is not the same class of thing as the app_metadata flag:
--
--   · It is written by us, in our own table, in a request that has already re-derived the
--     caller from their JWT and required ops_manager or admin. Nothing about the timing is
--     GoTrue's to decide.
--   · A client cannot forge it. RLS is on and there is no policy, so anon and authenticated
--     reach nothing at all; only the service role, which lives in the Edge Function's
--     environment, can write a row.
--   · It is single-use and short-lived. The trigger deletes the note as it reads it, and a
--     note older than five minutes is ignored, so one left behind by a failed createUser
--     cannot be spent by somebody else later.
--
-- The app_metadata check stays as a second path. If GoTrue does write it in the insert, it
-- works and costs nothing; if it does not, the note carries it. Neither is load-bearing
-- alone, which is the point.

create table if not exists public.office_invites (
  email      text primary key,
  invited_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.office_invites enable row level security;
-- Deliberately no policies. RLS with none denies everyone; the service role bypasses RLS,
-- and the service role is the only thing that should ever see this table. Same shape, and
-- the same reasoning, as export_nonces.
revoke all on public.office_invites from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  by_office boolean;
  recent    integer;
begin
  -- The note the office left, consumed as it is read. Five minutes is generous for the gap
  -- between one insert and the createUser call that follows it, and short enough that a
  -- note orphaned by a failed request is worthless.
  delete from public.office_invites
   where created_at <= now() - interval '5 minutes';

  delete from public.office_invites
   where lower(email) = lower(coalesce(new.email, ''))
  returning true into by_office;

  by_office := coalesce(by_office, false)
    or coalesce(new.raw_app_meta_data->>'created_by_office', '') = 'true';

  if not by_office then
    if lower(coalesce(new.email, '')) !~ '@makaman\.ly$' then
      raise exception 'Sign-up is limited to @makaman.ly addresses.'
        using errcode = '42501';
    end if;

    -- Five UNAPPROVED sign-ups at a time, from 0047. The cap exists to stop a flood of
    -- strangers arriving through a leaked link, and an account somebody in the office has
    -- already approved is not a stranger.
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

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
