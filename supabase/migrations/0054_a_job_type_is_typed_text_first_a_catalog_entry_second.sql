-- The job type on a ticket is free text everywhere it is written — the review field, and
-- the suggestion chips built from the job log (deriveTool/suggestJobTypes) that compose
-- phrasings like "PKR FOR CSG TEST & ACID JOB" nobody pre-registered anywhere. But the
-- only place it lived server-side was job_type_id, a foreign key into the office's
-- job_types catalog. rowTicket() looked the typed string up in that catalog on the way
-- out (idByJob[jobType] || null) and hydrate() looked the id back up on the way in
-- (jobById[job_type_id] || ''). A phrasing the catalog did not already hold came back
-- null from the first lookup and '' from the second — the job type vanished the moment
-- the ticket made a real round trip to the server, which an approved/closed ticket is the
-- one guaranteed to make. That is the "job type disappears once closed" report.
--
-- job_type_text is the fix: what was actually typed, stored and read back verbatim, no
-- catalog membership required. job_type_id stays — it is still useful for whoever curates
-- the catalog and wants to group tickets by it later — but it is no longer the only place
-- the words themselves live.

alter table public.tickets
  add column if not exists job_type_text text;

comment on column public.tickets.job_type_text is
  'The job type as actually typed or accepted, verbatim. The source of truth for display — job_type_id is a best-effort catalog link, not a requirement, since the job log suggestion feature composes phrasings the catalog was never told about.';

-- Backfill: every ticket that already resolved to a catalog entry gets its text filled in
-- from that entry, so existing tickets read identically before and after this migration.
-- Tickets whose job_type_id was already null (the ones that hit this bug) stay null here
-- too — the words that were lost cannot be recovered by a migration; only the app change
-- alongside this one stops it happening to the next ticket.
update public.tickets t
set job_type_text = jt.name
from public.job_types jt
where t.job_type_id = jt.id
  and t.job_type_text is null;
