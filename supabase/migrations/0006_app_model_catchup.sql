-- 20260820 · bring_schema_up_to_app_model   [APPLIED]
--
-- The schema was written before co-op tickets, device position, per-client currency,
-- office closure, allocated kit and the closing questions existed. This brings it level
-- with what the app actually does — the app's behaviour is the specification now, pinned
-- by 255 assertions, so the database moves to it rather than the reverse.

-- ── vocabulary ──────────────────────────────────────────────────────────────
-- The app calls a running job 'logging'. Two words for one state is how a filter ends up
-- silently matching nothing.
alter table public.tickets drop constraint if exists tickets_status_check;
update public.tickets set status = 'logging' where status = 'open';
alter table public.tickets add constraint tickets_status_check
  check (status in ('logging', 'done', 'approved'));
alter table public.tickets alter column status set default 'logging';

-- ── the ticket itself ───────────────────────────────────────────────────────
alter table public.tickets
  add column if not exists holder_id uuid references public.profiles(id),
  add column if not exists currency text not null default 'USD',
  add column if not exists geo_open jsonb,
  add column if not exists geo_last jsonb,
  add column if not exists geo_pinged_at timestamptz,
  add column if not exists office_closed boolean not null default false,
  add column if not exists closed_by uuid references public.profiles(id),
  add column if not exists closed_at timestamptz,
  add column if not exists synced boolean not null default false,
  add column if not exists synced_at timestamptz,
  add column if not exists base_location text not null default '',
  add column if not exists customer_rep text not null default '',
  add column if not exists asset_check jsonb;

comment on column public.tickets.currency is
  'Frozen at raise from the client''s contract. Sirte Oil Company is billed in LYD; everyone else in USD.';
comment on column public.tickets.closed_by is
  'Set only when the office closed a job the technician had not. Its presence is what tells a later field sync that its copy is stale rather than newer.';

-- ── co-op: everyone who has held the job, opener first ──────────────────────
create table if not exists public.ticket_crew (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (ticket_id, profile_id)
);
create index if not exists ticket_crew_profile_idx on public.ticket_crew(profile_id);
comment on table public.ticket_crew is
  'A job opened by one technician and finished by another after a rotation. Nobody is ever removed — both names print on the sheet and both may find the ticket.';

-- ── allocated kit, written straight onto the ticket ─────────────────────────
create table if not exists public.ticket_assets (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  item text not null default '',
  qty text not null default '',
  note text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ticket_assets_ticket_idx on public.ticket_assets(ticket_id);

-- ── the questions the Admin owns ────────────────────────────────────────────
create table if not exists public.asset_questions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  tone text not null default 'accent',
  multi boolean not null default false,
  presets text[] not null default '{}',
  sort_order integer not null default 0
);
comment on table public.asset_questions is
  'Asked of a technician who was allocated tools, when they close a job. Wording and options belong to the company, not the app — an option nobody uses just pushes people into free text.';

-- ── exactly one person allocates ticket numbers ─────────────────────────────
create table if not exists public.numbering_claim (
  id boolean primary key default true check (id),
  holder_id uuid references public.profiles(id),
  since timestamptz not null default now()
);
comment on table public.numbering_claim is
  'Single row by construction. Duplicate ticket numbers cannot be fixed after the fact — the number is already on a client sheet — so only one person may allocate at a time, and the claim is handed over deliberately.';

alter table public.ticket_numbering
  add column if not exists floor integer not null default 0,
  add column if not exists label text not null default '';
comment on column public.ticket_numbering.floor is
  'Where the series started. next_number walks back to here when a number is released, never below — otherwise releasing the only ticket would re-offer a number used years ago.';

-- ── org-wide defaults ───────────────────────────────────────────────────────
create table if not exists public.org_defaults (
  id boolean primary key default true check (id),
  base_location text not null default '',
  customer_rep text not null default '',
  round_trip_factor numeric not null default 2
);

-- ── charged lines carry percent rows and override marks ─────────────────────
alter table public.ticket_items
  add column if not exists kind text not null default 'flat' check (kind in ('flat', 'percent')),
  add column if not exists sign integer not null default 1,
  add column if not exists overrides jsonb;
comment on column public.ticket_items.kind is
  'A percent row is a surcharge or a discount computed against the flat lines, not a priced item; sign separates the two.';

-- ── the audit trail as the app writes it ────────────────────────────────────
-- The app records a sentence and a kind, not a field diff. Both shapes now fit: the
-- structured columns stay for stamp corrections, text/kind carry everything else.
alter table public.audit_log
  alter column field drop not null,
  add column if not exists text text,
  add column if not exists kind text not null default 'lifecycle'
    check (kind in ('lifecycle', 'edit', 'assets'));
comment on column public.audit_log.kind is
  'Who may read the entry is one rule, not three special cases: the office reads everything; the field and the Observer read lifecycle only. Tool custody is its own kind so it falls outside both.';
