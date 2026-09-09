-- Owner's request, 2026-09-09: "Why is there two toggles for location sharing one on the
-- account tab main page and another inside the settings tile. Are they doing the same
-- thing? Merge into one 'arrival location' at the account tab main page. Also activate a
-- second toggle for the periodic every-2h location retrieval." Then, same session, once
-- the two-hourly timer was actually looked at: "why not make it every time a technician
-- enters a new log line into his ticket - the location is captured. More reasonable and
-- less spam" — so the trigger this column governs shipped as geoLogPing, fired from
-- addEvent, not a setInterval; the column name and its "a refinement of share_location,
-- not a second consent" relationship to it are unchanged by that.
--
-- The two toggles were the same thing — both copies read and wrote user_settings
-- .share_location, one switch shown twice. The client side of that merge needs nothing
-- new from this table; it is the second, genuinely new switch that does. share_location
-- stays the master consent (the arrival pin, and the office being told anything about a
-- device's position at all); periodic_location is a refinement of it, read by the app
-- only while share_location is also true.
--
-- Defaulting periodic_location to false, then backfilling it from each row's own current
-- share_location, is deliberate: going forward a brand new technician sees both switches
-- off, matching share_location's own conservative default. But every technician who
-- already has share_location = true today has been getting a re-pin as an unadvertised,
-- inseparable part of that single switch since the day it shipped — a straight
-- `default false` would silently turn that off for every one of them the moment this
-- ships. The backfill is what keeps that live behaviour unchanged for accounts that
-- already opted in, while giving everyone a real, separate choice from here on.
alter table public.user_settings
  add column if not exists periodic_location boolean not null default false;

update public.user_settings
  set periodic_location = share_location
  where periodic_location is distinct from share_location;
