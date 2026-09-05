// Where this build gets its data and who it trusts to say who you are.
//
// The publishable key is meant to be public — it ships inside every client and is not a
// secret. What actually protects the data is row-level security in the database, which
// is why every table has policies and why the linter is run after each change. If RLS
// were wrong, hiding this key would not save anything.
//
// authMode:
//   'auto'  — use Supabase when a URL and key are present, otherwise fall back to the
//             local demo store. This is what a deploy runs.
//   'local' — never contact Supabase. Used by the behaviour tests, which are about what
//             the screens do, not about who signed in.
//   'cloud' — require Supabase; fail loudly rather than quietly falling back, so a
//             misconfigured deploy cannot silently serve demo data to a real crew.
// Merged rather than assigned, so anything set before this file loads wins. Tests pin
// authMode to 'local' that way; assigning over the top would silently ignore them and
// quietly point the behaviour tests at the live database.
// vapidPublicKey (0058): the PUBLIC half of the Web Push key pair — safe here for the same
// reason the publishable Supabase key above is. The private half never leaves the Vault;
// see get_push_vapid_private_key() and supabase/functions/send-push.
window.MAKAMAN_CONFIG = Object.assign({
  supabaseUrl: 'https://igutjfezxkdncrcpvnqx.supabase.co',
  supabaseKey: 'sb_publishable_pc-4gsPOIuNvvvgfxW1FLA_2eNW2Taf',
  authMode: 'auto',
  vapidPublicKey: 'BM6G4YIktE9kod_JV7Napbrbm0yvd09s7ja9z_SheYWCT-YGq8-zDm7Rhz_ao_m2vy7ae4piM9ENC9Uuq8g-SMw',
}, window.MAKAMAN_CONFIG || {});
