-- People have a real base.
--
-- The Account screen showed every employee at "Ahmadi Base", which is not a place this
-- company has. Makaman works out of two: the yard where the trucks and the crews are, and
-- the office. Technicians and the Ops Manager belong to the first, everyone else to the
-- second — so the base is a real column with a real constraint, not a caption.
--
-- Already applied to the project (2026-08-28); this file is the record of it. Written to
-- be re-runnable.

alter table public.profiles
  add column if not exists base text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_base_check'
  ) then
    alter table public.profiles
      add constraint profiles_base_check
      check (base is null or base in ('MKN Operations Base', 'MKN Headquarters'));
  end if;
end $$;

-- The default follows the role, and only the default does.
--
-- Two rules, and the second one is the careful one. A blank base is filled in from the
-- role. A base that still matches the default for the role somebody is LEAVING moves with
-- them, because it was never chosen — it was inherited. A base that does not match was
-- posted deliberately by the office, and a promotion is not a reason to overrule that.
create or replace function public.tg_profile_base_follows_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Only ever fills a blank, or moves somebody whose base still matches the default for
  -- the role they are leaving. Someone deliberately posted to the other base keeps it.
  if new.base is null then
    new.base := case when new.role in ('technician','ops_manager')
                     then 'MKN Operations Base' else 'MKN Headquarters' end;
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    if old.base = (case when old.role in ('technician','ops_manager')
                        then 'MKN Operations Base' else 'MKN Headquarters' end) then
      new.base := case when new.role in ('technician','ops_manager')
                       then 'MKN Operations Base' else 'MKN Headquarters' end;
    end if;
  end if;
  return new;
end;
$function$;

-- A SECURITY DEFINER function is not an API endpoint. It runs as the owner, so anybody
-- able to CALL it runs as the owner too — and a trigger function needs no caller at all.
-- Same rule as 0037.
revoke execute on function public.tg_profile_base_follows_role() from anon, authenticated;

drop trigger if exists trg_profile_base_follows_role on public.profiles;
create trigger trg_profile_base_follows_role
  before insert or update on public.profiles
  for each row execute function public.tg_profile_base_follows_role();

-- Backfill: everyone who predates the column.
update public.profiles
   set base = case when role in ('technician','ops_manager')
                   then 'MKN Operations Base' else 'MKN Headquarters' end
 where base is null;
