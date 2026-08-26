-- The approved-ticket master file: what a row is, where the file goes, and how anyone
-- knows how fresh it is.
--
-- The shape of a row lives here rather than inside the generating script. Finance's
-- definition of "one approved job" is a property of the data, and a view can be read,
-- diffed and corrected without redeploying anything.

-- ── Where the file lives ─────────────────────────────────────────────────────
-- Private, always. A permanent public URL to every approved job's totals is a price
-- list and a customer register handed to anyone who guesses the path (B-12.4).
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do update set public = false;

-- Nobody reads it through RLS: the file is fetched by a signed URL minted for the
-- person who asked, and written by the service role. No policies on storage.objects
-- for this bucket is the correct amount of policy.

-- ── What a row is ────────────────────────────────────────────────────────────
create or replace view public.master_export_rows as
select
  t.ticket_number                                   as "Ticket No",
  (t.approved_at at time zone 'Africa/Tripoli')::date as "Approved",
  (t.end_job_at  at time zone 'Africa/Tripoli')::date as "Job Ended",
  to_char(t.end_job_at at time zone 'Africa/Tripoli', 'YYYY-MM') as "Payroll Month",
  t.customer                                        as "Customer",
  t.field_name                                      as "Field",
  t.well_no                                         as "Well No",
  t.rig_name                                        as "Rig",
  tech.full_name                                    as "Technician",
  hold.full_name                                    as "Held By",
  jt.name                                           as "Job Type",
  (t.arrival_at    at time zone 'Africa/Tripoli')   as "Arrival",
  (t.start_job_at  at time zone 'Africa/Tripoli')   as "Start Job",
  (t.end_job_at    at time zone 'Africa/Tripoli')   as "End Job",
  t.mileage_one_way                                 as "Mileage (One Way) km",
  t.base_location                                   as "Base Location",
  t.customer_rep                                    as "Customer Rep",
  -- Currency is its own column and totals are never summed across it. Sirte prices in
  -- dinar and everyone else in dollars; one blended Total column would be a number that
  -- means nothing and would still add up in a spreadsheet.
  coalesce(t.currency, 'USD')                       as "Currency",
  coalesce(items.line_count, 0)                     as "Charged Items",
  coalesce(items.total, 0)                          as "Total",
  appr.full_name                                    as "Approved By"
from public.tickets t
left join public.profiles  tech on tech.id = t.technician_id
left join public.profiles  hold on hold.id = t.holder_id
left join public.profiles  appr on appr.id = t.approved_by
left join public.job_types jt   on jt.id   = t.job_type_id
left join lateral (
  select count(*) as line_count, sum(ti.total_cost) as total
  from public.ticket_items ti
  where ti.ticket_id = t.id
) items on true
where t.status = 'approved'
order by t.ticket_number nulls last, t.approved_at;

comment on view public.master_export_rows is
  'One row per approved ticket, in the column order the master workbook uses. Change the '
  'shape of the master file here, not in the export function.';

-- ── How fresh it is ──────────────────────────────────────────────────────────
create table if not exists public.export_runs (
  id           uuid primary key default gen_random_uuid(),
  kind         text        not null default 'master',
  status       text        not null check (status in ('running', 'ok', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  row_count    integer,
  object_path  text,
  error        text
);

create index if not exists export_runs_kind_started_idx
  on public.export_runs (kind, started_at desc);

comment on table public.export_runs is
  'One row per attempt to build an export. The most recent successful row is what the '
  'Account tab shows as the last sync; failures are kept so a stale file has a reason.';

alter table public.export_runs enable row level security;

-- Staff may see whether the file is current and why it is not. Nobody writes this from a
-- client — the export function does, with the service role.
drop policy if exists export_runs_select_staff on public.export_runs;
create policy export_runs_select_staff on public.export_runs
  for select to authenticated
  using (public.is_staff() or public.current_role() = 'founder');

-- ── Who may download it ──────────────────────────────────────────────────────
insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('export.master', 'Download the master file', 2, 'Reporting',
   'Fetch the workbook of every approved job. Served as a link that expires, never as a permanent URL.',
   array['ops_manager','admin','founder'])
on conflict (permission_id) do update set
  permission_name  = excluded.permission_name,
  permission_level = excluded.permission_level,
  category         = excluded.category,
  description      = excluded.description,
  default_roles    = excluded.default_roles;
