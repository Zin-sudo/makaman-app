-- The linter was right. `has_permission(uuid, text)` and `effective_permissions(uuid)`
-- take somebody else's id, run as definer, and were reachable at /rest/v1/rpc without
-- signing in — which makes "what is this person allowed to do" a public question. Nobody
-- unauthenticated has any business asking it, and a signed-in technician has no business
-- asking it about anyone but themselves.

revoke execute on function public.has_permission(uuid, text)     from anon, public;
revoke execute on function public.effective_permissions(uuid)    from anon, public;
revoke execute on function public.is_admin()                     from anon, public;

-- is_admin() stays callable by signed-in users because the RLS policy on
-- user_permissions evaluates it as the calling role; without EXECUTE the policy fails.
grant execute on function public.is_admin() to authenticated;

-- Asking about someone else is a supervisory act, so the answer is refused rather than
-- computed unless you are that person or you are staff. Enforced in the function, not
-- only by who is allowed to call it — the two arguments make it too easy to point
-- somewhere unintended.
create or replace function public.has_permission(p_user uuid, p_permission text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_user <> auth.uid() and not public.is_staff() then
    raise exception 'not allowed to read another user''s permissions';
  end if;

  return coalesce(
    (select up.granted
       from public.user_permissions up
      where up.user_id = p_user and up.permission_id = p_permission),
    (select p.default_roles @> array[pr.role]
       from public.permissions p
       cross join public.profiles pr
      where p.permission_id = p_permission and pr.id = p_user),
    false
  );
end;
$$;

create or replace function public.effective_permissions(p_user uuid)
returns table (permission_id text, granted boolean, source text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_user <> auth.uid() and not public.is_staff() then
    raise exception 'not allowed to read another user''s permissions';
  end if;

  return query
    select
      p.permission_id,
      coalesce(up.granted, p.default_roles @> array[pr.role], false),
      case when up.user_id is not null then 'override' else 'role' end
    from public.permissions p
    cross join public.profiles pr
    left join public.user_permissions up
           on up.permission_id = p.permission_id and up.user_id = pr.id
    where pr.id = p_user;
end;
$$;

grant execute on function public.has_permission(uuid, text)  to authenticated;
grant execute on function public.effective_permissions(uuid) to authenticated;

-- What the app actually calls on sign-in: my own permissions, no argument to point
-- anywhere else, nothing to get wrong at the call site.
create or replace function public.my_permissions()
returns table (permission_id text, granted boolean, source text)
language sql stable security definer set search_path = public
as $$
  select
    p.permission_id,
    coalesce(up.granted, p.default_roles @> array[pr.role], false),
    case when up.user_id is not null then 'override' else 'role' end
  from public.permissions p
  cross join public.profiles pr
  left join public.user_permissions up
         on up.permission_id = p.permission_id and up.user_id = pr.id
  where pr.id = auth.uid();
$$;

revoke execute on function public.my_permissions() from anon, public;
grant  execute on function public.my_permissions() to authenticated;
