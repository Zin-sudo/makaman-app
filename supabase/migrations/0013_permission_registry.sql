-- The permission registry.
--
-- Until now "who may do what" was twenty-eight role comparisons scattered through
-- index.html. That is fine until someone needs one technician to assign numbers, or an
-- ops manager kept out of the price list — neither of which a role can express. This
-- names each capability once, gives it a default set of roles, and allows a per-person
-- override on top.
--
-- permission_level is severity, not rank: 1 routine field work, 2 supervisory,
-- 3 administrative. It orders the admin screen and answers "how alarming is this
-- grant"; it does NOT imply that level 3 includes level 2. Observer is deliberately
-- outside any ranking — it is broad read access and almost no write access — which is
-- why the default set is an explicit list of roles rather than a number to compare.

create table if not exists public.permissions (
  permission_id     text primary key,
  permission_name   text        not null,
  permission_level  smallint    not null check (permission_level between 1 and 3),
  category          text        not null,
  description       text        not null,
  -- Which roles hold this without anyone granting it. Constrained so a typo becomes an
  -- error here rather than a silently ineffective permission at read time.
  default_roles     text[]      not null default '{}',
  created_at        timestamptz not null default now(),
  constraint permissions_default_roles_known check (
    default_roles <@ array['technician','ops_manager','admin','founder']::text[]
  )
);

comment on table public.permissions is
  'Catalogue of capabilities. Rows are reference data, edited by migration, not by the app.';

-- A grant or a revoke aimed at one person, overriding whatever their role would give
-- them. Revoking is as important as granting: taking the price list away from one ops
-- manager needs a row that says false, not the absence of a row.
create table if not exists public.user_permissions (
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  permission_id text        not null references public.permissions(permission_id) on delete cascade,
  granted       boolean     not null,
  set_by        uuid        references public.profiles(id) on delete set null,
  set_at        timestamptz not null default now(),
  primary key (user_id, permission_id)
);

create index if not exists user_permissions_user_idx on public.user_permissions(user_id);

comment on column public.user_permissions.granted is
  'true grants what the role would not give; false revokes what it would. Absence means follow the role.';

-- ── Reading a permission ─────────────────────────────────────────────────────
-- SECURITY DEFINER and a profiles lookup, deliberately. Reading the role out of the JWT
-- would be faster and wrong: a token minted before a role change still carries the old
-- one, and would keep carrying it until it expired (BLINDSPOTS B-7.2).

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false);
$$;

create or replace function public.has_permission(p_user uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    -- An explicit row about this person wins, whichever way it points.
    (select up.granted
       from public.user_permissions up
      where up.user_id = p_user and up.permission_id = p_permission),
    -- Otherwise the role decides.
    (select p.default_roles @> array[pr.role]
       from public.permissions p
       cross join public.profiles pr
      where p.permission_id = p_permission and pr.id = p_user),
    false
  );
$$;

-- The whole answer for one person in one round trip, which is what the app hydrates.
create or replace function public.effective_permissions(p_user uuid)
returns table (permission_id text, granted boolean, source text)
language sql stable security definer set search_path = public
as $$
  select
    p.permission_id,
    coalesce(up.granted, p.default_roles @> array[pr.role], false) as granted,
    case when up.user_id is not null then 'override' else 'role' end as source
  from public.permissions p
  cross join public.profiles pr
  left join public.user_permissions up
         on up.permission_id = p.permission_id and up.user_id = pr.id
  where pr.id = p_user;
$$;

-- ── Who may read and write this ──────────────────────────────────────────────
alter table public.permissions      enable row level security;
alter table public.user_permissions enable row level security;

-- The catalogue is not secret; the app needs it to render the admin screen, and knowing
-- a capability exists grants nothing.
drop policy if exists permissions_select_all on public.permissions;
create policy permissions_select_all on public.permissions
  for select to authenticated using (true);

-- Reference data. No client writes it, in any role — it changes by migration alongside
-- the code that honours it, or the two drift.

drop policy if exists user_permissions_select_own on public.user_permissions;
create policy user_permissions_select_own on public.user_permissions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_permissions_select_staff on public.user_permissions;
create policy user_permissions_select_staff on public.user_permissions
  for select to authenticated using (public.is_staff());

-- Only an Admin may change a grant, and the check is a profiles lookup, not a claim.
-- Unlike profiles, this table is safe for a client to write under such a policy: the
-- worst an Admin can do here is what an Admin may already do.
drop policy if exists user_permissions_write_admin on public.user_permissions;
create policy user_permissions_write_admin on public.user_permissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.permissions from anon;
revoke all on public.user_permissions from anon;
