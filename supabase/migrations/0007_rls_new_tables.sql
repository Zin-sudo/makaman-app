-- 20260820 · rls_for_new_tables   [APPLIED]
--
-- A new table with RLS enabled and no policy is unreadable; a new table without RLS is
-- readable by anyone holding the anon key. Neither is acceptable, so every table added
-- gets both, in the same commit that created it.

alter table public.ticket_crew enable row level security;
alter table public.ticket_assets enable row level security;
alter table public.asset_questions enable row level security;
alter table public.numbering_claim enable row level security;
alter table public.org_defaults enable row level security;

-- Membership of a crew decides who can see the job, so it has to be readable by the
-- people in it — checked directly against auth.uid() rather than through tickets, which
-- would recurse into the ticket policy that consults this table.
create policy ticket_crew_select_own on public.ticket_crew for select
  using (profile_id = auth.uid());
create policy ticket_crew_select_staff on public.ticket_crew for select
  using (public.is_staff() or public.current_role() = 'founder');
create policy ticket_crew_write_staff on public.ticket_crew for all
  using (public.is_staff()) with check (public.is_staff());
-- A technician hands a job on themselves, so they may add the person taking it.
create policy ticket_crew_insert_holder on public.ticket_crew for insert
  with check (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and t.holder_id = auth.uid() and t.status = 'logging'
  ));

-- Allocated kit: the office writes it, the technician holding the job reads it. The
-- Observer is deliberately absent — tool custody is internal to the office and the field.
create policy ticket_assets_select_crew on public.ticket_assets for select
  using (exists (
    select 1 from public.ticket_crew c where c.ticket_id = ticket_id and c.profile_id = auth.uid()
  ));
create policy ticket_assets_select_staff on public.ticket_assets for select using (public.is_staff());
create policy ticket_assets_write_staff on public.ticket_assets for all
  using (public.is_staff()) with check (public.is_staff());

-- The questions are read by whoever answers them; only the Admin rewords them.
create policy asset_questions_select_all on public.asset_questions for select
  using (auth.uid() is not null);
create policy asset_questions_write_admin on public.asset_questions for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Everyone in the office can see who holds the numbering claim — that is the point of
-- it. Only the current holder or an Admin can move it, enforced here rather than only in
-- the UI, so a hidden button is not the thing standing between two people allocating.
create policy numbering_claim_select_staff on public.numbering_claim for select
  using (public.is_staff() or public.current_role() = 'founder');
create policy numbering_claim_update_holder on public.numbering_claim for update
  using (holder_id = auth.uid() or public.current_role() = 'admin' or holder_id is null)
  with check (public.is_staff());
create policy numbering_claim_insert_admin on public.numbering_claim for insert
  with check (public.current_role() = 'admin');

create policy org_defaults_select_all on public.org_defaults for select
  using (auth.uid() is not null);
create policy org_defaults_write_admin on public.org_defaults for all
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
