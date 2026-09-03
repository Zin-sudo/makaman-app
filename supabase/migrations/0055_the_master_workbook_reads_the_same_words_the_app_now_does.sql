-- master_export_rows joined "Job Type" purely off job_type_id, the same lookup that just
-- lost the words for any ticket whose phrasing the job_types catalog had never seen
-- (0054). The app is fixed; this view read from the same table and had the identical
-- blind spot — the master workbook Finance actually reads would still show a blank "Job
-- Type" for exactly the tickets 0054 was written for. coalesce onto job_type_text so the
-- exported column matches what the app now shows.

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
  coalesce(t.job_type_text, jt.name)                as "Job Type",
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
  'column list here and every export picks it up on the next run. "Job Type" prefers '
  'job_type_text (0054) over the job_types catalog join, since the catalog does not know '
  'every phrasing the job log suggestion feature composes.';
