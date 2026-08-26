# Makaman CSS Migration — Complete Implementation Guide
## How to Apply All 3 Batches to Your PWA

---

## 📦 What You Have (3 Batches)

### Batch 1 — Foundation
| File | What It Is |
|------|-----------|
| `app/makaman-responsive-theme-v2.css` | The complete design system |
| `app/permissions.js` | Permission state, defaults, apply functions |
| `app/admin/permissions.html` | Admin page to toggle 22 permissions |
| `app/support.js` additions | `initPermissions()`, `renderWithPermissions()`, sync status, empty states |

### Batch 2 — Migration Toolkit
| File | What It Is |
|------|-----------|
| `migrations/BATCH2_FIND_REPLACE_GUIDE.md` | 14 find/replace patterns |
| `migrations/COMPONENT_EXAMPLES.html` | Before/after templates for every component |
| `migrations/migration-helper.js` | Browser console audit tool |
| `app/manifest.webmanifest` | Updated colors to `#0a0a0f` |
| `app/sw.js` | Cache bumped to `v5` |

### Batch 3 — Production Templates
| File | What It Is |
|------|-----------|
| `app/index.html` | **Complete working app** with all 4 role screens, CSS injected, role wrappers, permission wiring |
| `app/support.js` | **Complete** with all integration functions |
| `app/admin/permissions.html` | **Complete** admin permissions page with CSS injected |

---

## 🚀 Implementation Path (Choose One)

### PATH A: Merge Into Existing Project (Recommended if you have existing code)

**Step 1 — Drop in the foundation files**
```
Copy these INTO your existing project:
  app/makaman-responsive-theme-v2.css  →  app/
  app/permissions.js                    →  app/
  app/manifest.webmanifest              →  app/ (overwrite)
  app/sw.js                             →  app/ (overwrite)
```

**Step 2 — Inject CSS into your existing `index.html`**
```html
<head>
  <!-- AFTER meta tags, BEFORE other styles -->
  <style>
    /* PASTE ENTIRE contents of makaman-responsive-theme-v2.css here */
  </style>

  <!-- ADD this script BEFORE support.js -->
  <script src="permissions.js"></script>

  <!-- your existing scripts -->
  <script src="support.js"></script>
</head>
```

**Step 3 — Add the support.js functions**
Open your existing `support.js` and append ALL functions from Batch 3's `support.js`.
The key functions you need:
- `initPermissions()`
- `renderWithPermissions(role)`
- `updateSyncStatus(elementId, status, count)`
- `renderEmptyState(type)`
- `renderStalledAlert(name, base)`
- `renderAuditTrail(events)`
- `showConfirmModal(title, message, onConfirm, onCancel)`

**Step 4 — Wrap your screens in role containers**
Find each screen's root `<div>` and wrap it:
```html
<!-- Technician screen -->
<div class="role-technician" data-perm-create="true" data-perm-gps="true" ...>
  <nav class="mk-navbar">...</nav>
  <div class="mk-container mk-container-tech mk-py-6">
    <!-- your existing content -->
  </div>
</div>
```
Use the `BATCH2_FIND_REPLACE_GUIDE.md` for the exact attributes.

**Step 5 — Replace inline styles with mk-* classes**
Work through the 14 patterns in the guide one by one.
Use `COMPONENT_EXAMPLES.html` as copy-paste reference.

**Step 6 — Call `renderWithPermissions(role)` before each screen render**
```javascript
function showTechnicianScreen() {
  renderWithPermissions('technician');  // ← ADD THIS
  // ... your existing render logic
}
```

**Step 7 — Test**
- Open DevTools → Console → run `MigrationHelper.audit()`
- Check each breakpoint: 375px, 768px, 1024px, 1440px
- Toggle permissions in admin page → verify hide/show

---

### PATH B: Use Batch 3 as Your New Base (Recommended if starting fresh or heavy rewrite)

Batch 3's `index.html` is a **complete working app** with all 4 role screens.

**Step 1 — Backup your project**
```bash
cp -r my-pwa my-pwa-backup
```

**Step 2 — Replace files**
```
Copy Batch 3 files OVER your existing:
  app/index.html              →  overwrite
  app/support.js              →  overwrite (or merge if you have custom logic)
  app/permissions.js          →  new file
  app/admin/permissions.html  →  new file
  app/manifest.webmanifest    →  overwrite
  app/sw.js                   →  overwrite
```

**Step 3 — Migrate your custom logic**
The Batch 3 `index.html` has placeholder content. Replace the placeholder:
- Ticket list items → your real ticket data
- Stats numbers → your real stats
- Table rows → your real data
- Keep the `mk-*` classes and role wrappers

**Step 4 — Wire your router**
The Batch 3 `index.html` has a simple hash-based screen switcher:
```javascript
function showScreen(name) {
  document.querySelectorAll('[id^="screen-"]').forEach(el => el.style.display = 'none');
  document.getElementById('screen-' + name).style.display = 'block';
  renderWithPermissions(name === 'ops' ? 'ops' : name);
}
```
Replace this with your existing router, but keep the `renderWithPermissions()` call.

**Step 5 — Test**
Same as Path A Step 7.

---

## 🔧 Quick Reference: What Changes in Your HTML

### Before (your current code):
```html
<div style="background:#1d2d3d; border-radius:8px; padding:20px; margin-bottom:16px;">
  <h2 style="font-size:20px; font-weight:bold; color:#fff;">Ticket #1042</h2>
  <button style="background:#c41e3a; color:#fff; padding:12px 20px;">Approve</button>
</div>
```

### After (Makaman v2):
```html
<div class="mk-card mk-mb-4">
  <h2 class="mk-text-xl mk-font-bold">Ticket #1042</h2>
  <button class="mk-btn mk-btn-primary">Approve</button>
</div>
```

---

## 🔧 Quick Reference: What Changes in Your JS

### Before (your current code):
```javascript
function renderScreen() {
  const html = `<div style="background:#1d2d3d">...</div>`;
  document.getElementById('app').innerHTML = html;
}
```

### After (Makaman v2):
```javascript
function renderScreen() {
  renderWithPermissions('technician');  // ← ADD THIS
  const html = `<div class="mk-card">...</div>`;
  document.getElementById('app').innerHTML = html;
}
```

---

## 🧪 Testing Checklist

- [ ] Open app in Chrome DevTools
- [ ] Toggle device toolbar to **iPhone SE** (375px) → verify mobile layout
- [ ] Toggle device toolbar to **iPad** (768px) → verify tablet layout
- [ ] Resize browser to **1024px** → verify laptop layout (sidebars appear)
- [ ] Resize browser to **1440px** → verify desktop layout
- [ ] Test each role tab in admin permissions page
- [ ] Toggle a permission OFF → verify related container hides
- [ ] Toggle a permission ON → verify related container reappears
- [ ] Test dangerous combination (Tech can't mark done + Ops can't approve) → verify warning banner
- [ ] Test PWA install → verify splash screen is dark
- [ ] Test offline mode → verify CSS still loads from cache

---

## 🆘 Troubleshooting

**Problem:** Styles not applying
→ Check that the `<style>` block with makaman CSS is in `<head>` and loads BEFORE your content

**Problem:** Permission hide/show not working
→ Verify `data-perm-*` attributes are set on the `.role-*` wrapper
→ Check that `renderWithPermissions(role)` is called BEFORE rendering content

**Problem:** Admin page shows raw HTML
→ Make sure `permissions.js` is loaded before the admin page scripts

**Problem:** Old styles still showing
→ Clear browser cache (Ctrl+Shift+R) or bump sw.js cache version

---

## 📞 Next Steps

1. Choose **Path A** or **Path B**
2. Apply the steps above
3. Test on your device
4. If issues arise, upload the specific file that's broken and I'll fix it
