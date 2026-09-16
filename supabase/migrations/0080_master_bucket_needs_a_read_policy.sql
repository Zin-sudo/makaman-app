-- 2026-09-11: the real Master File was uploaded (by the owner, via the Supabase dashboard)
-- into its own new private bucket, 'master', rather than reusing 'exports' — which, on
-- inspection, turns out to have carried zero storage.objects policies of its own the whole
-- time. downloadMaster() (app/index.html) calls createSignedUrl() with the SIGNED-IN
-- PERSON's own session, not the service-role key, and Supabase gates minting a signed URL
-- on the same RLS a plain SELECT would need — so this placeholder "Download" button could
-- never have actually worked for a real ops_manager/admin/founder session, only for calls
-- made with the service-role key. Giving the new bucket the read policy the whole feature
-- always needed, staff-or-founder, matching export_runs' own read audience (same rule,
-- same reasoning: CLAUDE.md's activity-visibility standing instruction).
create policy master_bucket_select_staff on storage.objects for select
  using (bucket_id = 'master' and (is_staff() or public."current_role"() = 'founder'));
