-- 20260820 · complete_numbering_series   [APPLIED]
--
-- Two series already carried live counters ahead of the seeded defaults (D at 5025, F at
-- 724). Seeding over them would re-offer numbers already printed on client sheets, so
-- only the missing series is added and the existing counters are left exactly as found.

-- Special Tools: plain four-digit numbers, no prefix. Absent until now.
insert into public.ticket_numbering (prefix, label, next_number, floor, note)
select '', 'Special Tools', 1884, 1883, 'Plain four-digit numbers'
where not exists (select 1 from public.ticket_numbering where prefix = '');

-- The human name was sitting in note while label was blank.
update public.ticket_numbering set label = note where label = '' and note is not null and note <> '';

-- floor is where a series may roll back to when a number is released. Zero would let a
-- release offer a number from before the company started counting. Nothing records where
-- these two actually began, so the floor is pinned to where they stand now: a released
-- number can be re-offered, but nothing below it can.
update public.ticket_numbering set floor = greatest(next_number - 1, floor) where floor = 0;

-- prefix identifies a series; two rows sharing one would make "next free number" ambiguous.
create unique index if not exists ticket_numbering_prefix_key on public.ticket_numbering(prefix);
