-- 20260820 · seed_reference_rows   [APPLIED]
--
-- The rows the app expects to find on a cold start. Written so re-running is harmless:
-- a re-import or a second deploy must not duplicate a numbering series or reset a
-- question the Admin has since reworded.

-- The three closing questions, as shipped. on conflict do nothing, not do update — once
-- the Admin has reworded one, this migration must never quietly put it back.
insert into public.asset_questions (key, label, tone, multi, presets, sort_order) values
  ('reclaimed',  'Tools allocated reclaimed or back-to-base?', 'warning', false,
   array['Yes', 'Not yet', 'Handed over to replacement'], 0),
  ('location',   'Tools allocated location?',                  'accent',  true,
   array['In vehicle', 'At String-30', 'At rig'], 1),
  ('leftBehind', 'Tools allocated left behind or damaged?',     'success', false,
   array['None'], 2)
on conflict (key) do nothing;

-- (The numbering series seed moved to 0010: the live counters were found to be ahead
-- of the defaults, so they could not be seeded blind.)

-- One row, by construction. Left unclaimed: an Admin assigns it to whoever is on shift
-- rather than the migration guessing at a name.
insert into public.numbering_claim (id, holder_id) values (true, null)
on conflict (id) do nothing;

insert into public.org_defaults (id, base_location, customer_rep, round_trip_factor)
values (true, 'Ahmadi Base', 'Workover Office', 2)
on conflict (id) do nothing;

-- Every existing ticket needs its opener in the crew, or the new crew-based visibility
-- would hide every ticket that predates co-op from the person who raised it.
insert into public.ticket_crew (ticket_id, profile_id, position)
select id, technician_id, 0 from public.tickets
on conflict (ticket_id, profile_id) do nothing;

-- Same for the holder: a ticket with no holder can be written by nobody under the new
-- update policy.
update public.tickets set holder_id = technician_id where holder_id is null;

-- Sirte is billed in dinar; everyone else in dollars.
update public.tickets t set currency = 'LYD'
  from public.clients c
 where c.id = t.client_id and c.name ilike '%Sirte%' and t.currency <> 'LYD';
