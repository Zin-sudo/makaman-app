-- Makaman Job Tickets — initial schema, RLS, auth trigger, seed reference data.
-- See app/../HANDOFF.md for the full brief and role matrix this schema implements.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'technician' check (role in ('technician', 'ops_manager', 'admin', 'founder')),
  status text not null default 'pending' check (status in ('pending', 'active')),
  created_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  accent text not null default 'red' check (accent in ('red', 'blue', 'green', 'amber', 'purple')),
  timezone text not null default 'Africa/Tripoli',
  hour12 boolean not null default false,
  share_location boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.price_list_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  item_number text not null,
  description text not null default '',
  uom text not null default '',
  unit_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, item_number)
);

create table public.job_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- Reference numbering series shown to the Ops Manager during review.
-- NOT an auto-assigner — see HANDOFF.md §4.
create table public.ticket_numbering (
  id uuid primary key default gen_random_uuid(),
  prefix text not null,
  next_number integer not null default 1,
  note text
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id),
  customer text not null default '',
  field_name text not null default '',
  well_no text not null default '',
  rig_name text not null default '',
  arrival_at timestamptz,
  start_job_at timestamptz,
  end_job_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'approved')),
  ops_location_note text,
  ticket_number text unique,
  client_id uuid references public.clients(id),
  job_type_id uuid references public.job_types(id),
  mileage_one_way numeric,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tickets_technician_id_idx on public.tickets(technician_id);
create index tickets_status_idx on public.tickets(status);

create table public.ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  logged_at timestamptz not null,
  text text not null,
  edited_by uuid references public.profiles(id),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index ticket_lines_ticket_id_idx on public.ticket_lines(ticket_id);

create table public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  item_number text not null default '',
  description text not null default '',
  qty numeric not null default 1,
  uom text not null default '',
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index ticket_items_ticket_id_idx on public.ticket_items(ticket_id);

-- Every stamp correction — ticket-level (Arrival/Start/End) AND individual
-- job-log line timestamps — is appended here. Both were confirmed editable
-- by Ops Manager / Admin, so both write through the same trail.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now(),
  note text
);

create index audit_log_ticket_id_idx on public.audit_log(ticket_id);

-- ---------------------------------------------------------------------------
-- Auth trigger: every signup gets a matching profile row, always pending.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'technician', 'pending');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so they can read profiles under RLS
-- without recursing into the policies that call them).
-- ---------------------------------------------------------------------------

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select status from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_role() in ('ops_manager', 'admin'), false);
$$;

-- Guards what a technician is allowed to change on their own ticket via a
-- direct client update: no touching stamps once Job Done has been pressed,
-- no touching Ops-only assignment fields, and nothing once approved.
-- Ops Manager / Admin bypass all of this (tickets_update_staff policy covers them).
create or replace function public.enforce_ticket_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() = 'technician' then
    if old.status = 'approved' then
      raise exception 'Ticket already approved and can no longer be edited.';
    end if;
    if old.end_job_at is not null and (
      new.arrival_at is distinct from old.arrival_at or
      new.start_job_at is distinct from old.start_job_at or
      new.end_job_at is distinct from old.end_job_at
    ) then
      raise exception 'Arrival/Start/End stamps can only be corrected by Ops Manager or Admin after Job Done.';
    end if;
    if new.ticket_number is distinct from old.ticket_number
      or new.client_id is distinct from old.client_id
      or new.job_type_id is distinct from old.job_type_id
      or new.mileage_one_way is distinct from old.mileage_one_way
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.status = 'approved' then
      raise exception 'Only Ops Manager or Admin can assign ticket number, mileage, job type or approve.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_before_update
  before update on public.tickets
  for each row execute function public.enforce_ticket_update_rules();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.clients enable row level security;
alter table public.price_list_items enable row level security;
alter table public.job_types enable row level security;
alter table public.ticket_numbering enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_lines enable row level security;
alter table public.ticket_items enable row level security;
alter table public.audit_log enable row level security;

-- profiles: users see their own row; staff see everyone. Role/status changes
-- only ever happen through the admin-actions Edge Function (service role,
-- bypasses RLS) — there is deliberately no client-side UPDATE policy here.
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy profiles_select_staff on public.profiles for select using (public.is_staff());

-- user_settings: strictly own row.
create policy user_settings_all_own on public.user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reference data: any authenticated user can read; only Admin writes.
create policy clients_select_all on public.clients for select using (auth.uid() is not null);
create policy clients_write_admin on public.clients for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy price_list_items_select_all on public.price_list_items for select using (auth.uid() is not null);
create policy price_list_items_write_admin on public.price_list_items for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy job_types_select_all on public.job_types for select using (auth.uid() is not null);
create policy job_types_write_admin on public.job_types for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

create policy ticket_numbering_select_staff on public.ticket_numbering for select using (public.is_staff());
create policy ticket_numbering_write_admin on public.ticket_numbering for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- tickets
create policy tickets_select_own on public.tickets for select using (technician_id = auth.uid());
create policy tickets_select_staff on public.tickets for select using (public.is_staff());
create policy tickets_select_founder on public.tickets for select
  using (public.current_role() = 'founder' and status = 'approved');

create policy tickets_insert_own on public.tickets for insert
  with check (technician_id = auth.uid() and public.current_role() in ('technician', 'admin'));

create policy tickets_update_own on public.tickets for update
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid());

create policy tickets_update_staff on public.tickets for update
  using (public.is_staff()) with check (public.is_staff());

-- ticket_lines
create policy ticket_lines_select_own on public.ticket_lines for select
  using (exists (select 1 from public.tickets t where t.id = ticket_id and t.technician_id = auth.uid()));
create policy ticket_lines_select_staff on public.ticket_lines for select using (public.is_staff());

create policy ticket_lines_insert_own on public.ticket_lines for insert
  with check (exists (
    select 1 from public.tickets t where t.id = ticket_id and t.technician_id = auth.uid() and t.status = 'open'
  ));

create policy ticket_lines_update_own on public.ticket_lines for update
  using (exists (
    select 1 from public.tickets t where t.id = ticket_id and t.technician_id = auth.uid() and t.status = 'open'
  ));

-- Confirmed in this session: individual job-log line timestamps are editable
-- by Ops Manager / Admin too, same as the ticket-level Arrival/Start/End
-- stamps — not locked as originally scoped. Every such edit is written to
-- audit_log by the client alongside this update.
create policy ticket_lines_update_staff on public.ticket_lines for update
  using (public.is_staff()) with check (public.is_staff());

-- ticket_items: Ops/Admin manage them; Founder can read on approved tickets.
create policy ticket_items_all_staff on public.ticket_items for all
  using (public.is_staff()) with check (public.is_staff());
create policy ticket_items_select_founder on public.ticket_items for select
  using (
    public.current_role() = 'founder'
    and exists (select 1 from public.tickets t where t.id = ticket_id and t.status = 'approved')
  );

-- audit_log: Ops/Admin write and read.
create policy audit_log_insert_staff on public.audit_log for insert
  with check (public.is_staff() and changed_by = auth.uid());
create policy audit_log_select_staff on public.audit_log for select using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Seed reference data — placeholder stand-ins per HANDOFF.md §B.1, to be
-- replaced once the real price list workbook arrives.
-- ---------------------------------------------------------------------------

insert into public.job_types (name) values
  ('Wireline Logging'), ('Well Intervention'), ('Perforating'), ('Pressure Testing'), ('Rig-Up / Rig-Down');

insert into public.ticket_numbering (prefix, next_number, note) values
  ('MK-', 1001, 'Default series — reference only');

with c as (
  insert into public.clients (name) values ('Sample Client — replace with real client') returning id
)
insert into public.price_list_items (client_id, item_number, description, uom, unit_cost)
select c.id, v.item_number, v.description, v.uom, v.unit_cost
from c, (values
  ('ITM-100', 'Wireline unit — standard call-out', 'EA', 850.00),
  ('ITM-200', 'Logging tool rental — per day', 'DAY', 420.00),
  ('ITM-300', 'Technician overtime — per hour', 'HR', 65.00)
) as v(item_number, description, uom, unit_cost);
