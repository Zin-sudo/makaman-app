# Makaman CSS Migration — Batch 2: Find & Replace Guide

## How to Use This Guide

1. Open your `app/index.html` and `app/support.js` in your code editor
2. Use Find & Replace (Ctrl+H / Cmd+H) with the patterns below
3. Replace ONE pattern at a time and test
4. Save backups before each batch

---

## Pattern 1: Inline Style Objects (React/JSX style)

### Find: Card backgrounds
```
style={{background:'#1d2d3d', borderRadius:8, padding:20}}
```
### Replace:
```
className="mk-card"
```

### Find: Card with margin
```
style={{background:'#1d2d3d', borderRadius:8, padding:20, marginBottom:16}}
```
### Replace:
```
className="mk-card mk-mb-4"
```

---

## Pattern 2: Buttons

### Find: Primary button
```
style={{background:'#c41e3a', color:'#fff'}}
```
### Replace:
```
className="mk-btn mk-btn-primary"
```

### Find: Secondary/outline button
```
style={{background:'#f5f5f5'}}
```
### Replace:
```
className="mk-btn mk-btn-secondary"
```

### Find: Danger/delete button
```
style={{background:'#ef4444', color:'#fff'}}
```
### Replace:
```
className="mk-btn mk-btn-danger"
```

---

## Pattern 3: Inputs

### Find: Text input
```
style={{background:'#f5f5f5', padding:10, borderRadius:4}}
```
### Replace:
```
className="mk-input"
```

---

## Pattern 4: Navbar / Topbar

### Find: Dark topbar
```
style={{background:'rgba(0,0,0,0.3)', padding:'12px 16px'}}
```
### Replace:
```
className="mk-navbar"
```

---

## Pattern 5: Flex Layouts

### Find: Space-between flex
```
style={{display:'flex', justifyContent:'space-between'}}
```
### Replace:
```
className="mk-flex mk-justify-between"
```

### Find: Centered flex
```
style={{display:'flex', justifyContent:'center', alignItems:'center'}}
```
### Replace:
```
className="mk-flex mk-justify-center mk-items-center"
```

### Find: Column flex
```
style={{display:'flex', flexDirection:'column'}}
```
### Replace:
```
className="mk-flex mk-flex-col"
```

---

## Pattern 6: Spacing

### Find: Margin bottom
```
style={{marginBottom:16}}
```
### Replace:
```
className="mk-mb-4"
```

### Find: Margin bottom large
```
style={{marginBottom:24}}
```
### Replace:
```
className="mk-mb-6"
```

### Find: Margin top
```
style={{marginTop:16}}
```
### Replace:
```
className="mk-mt-4"
```

### Find: Padding
```
style={{padding:16}}
```
### Replace:
```
className="mk-p-4"
```

---

## Pattern 7: Badges

### Find: Green status badge
```
style={{background:'green', padding:'4px 8px', borderRadius:12}}
```
### Replace:
```
className="mk-badge mk-badge-ok"
```

### Find: Yellow warning badge
```
style={{background:'orange', padding:'4px 8px', borderRadius:12}}
```
### Replace:
```
className="mk-badge mk-badge-warn"
```

### Find: Blue info badge
```
style={{background:'blue', padding:'4px 8px', borderRadius:12}}
```
### Replace:
```
className="mk-badge mk-badge-info"
```

---

## Pattern 8: Typography

### Find: Large heading
```
style={{fontSize:24, fontWeight:'bold'}}
```
### Replace:
```
className="mk-text-2xl mk-font-bold"
```

### Find: Medium heading
```
style={{fontSize:20, fontWeight:'bold'}}
```
### Replace:
```
className="mk-text-xl mk-font-bold"
```

### Find: Small muted text
```
style={{fontSize:14, color:'#888'}}
```
### Replace:
```
className="mk-text-sm" style="color: var(--mk-text-muted);"
```

---

## Pattern 9: Tables

### Before:
```html
<table>
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

### After:
```html
<div class="mk-table-wrap">
  <table class="mk-table">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>
</div>
```

---

## Pattern 10: Grids

### Find: 2-column grid
```
style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}
```
### Replace:
```
className="mk-grid mk-grid-2"
```

### Find: 3-column grid
```
style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16}}
```
### Replace:
```
className="mk-grid mk-grid-3"
```

---

## Pattern 11: Role Wrappers

### Before (Technician screen):
```html
<div>
  <nav>...</nav>
  <div>content</div>
</div>
```

### After:
```html
<div class="role-technician" data-perm-create="true" data-perm-gps="true" data-perm-sync="true" data-perm-history="true" data-perm-attachments="true" data-perm-pricing="false" data-perm-edit-customer="false">
  <nav class="mk-navbar">...</nav>
  <div class="mk-container mk-container-tech mk-py-6">
    content
  </div>
</div>
```

### Before (Ops screen):
```html
<div>
  <nav>...</nav>
  <div>content</div>
</div>
```

### After:
```html
<div class="role-ops" data-perm-approve="true" data-perm-edit-timestamps="true" data-perm-assign-number="true" data-perm-discount="true" data-perm-remove-surcharge="false" data-perm-preview="true" data-perm-export="true" data-perm-reopen="true" data-perm-all-bases="false" data-perm-edit-items="true">
  <nav class="mk-navbar">...</nav>
  <div class="mk-container mk-py-6">
    content
  </div>
</div>
```

### Before (Admin screen):
```html
<div>
  <nav>...</nav>
  <div>content</div>
</div>
```

### After:
```html
<div class="role-admin">
  <nav class="mk-navbar">...</nav>
  <div class="mk-container mk-container-admin mk-py-6">
    content
  </div>
</div>
```

### Before (Observer screen):
```html
<div>
  <nav>...</nav>
  <div>content</div>
</div>
```

### After:
```html
<div class="role-observer" data-perm-live="true" data-perm-approved="true" data-perm-stats="true" data-perm-locations="true" data-perm-export-reports="true" data-perm-pending="false" data-perm-audit="false">
  <nav class="mk-navbar">...</nav>
  <div class="mk-container mk-container-observer mk-py-6">
    content
  </div>
</div>
```

---

## Pattern 12: Remove Old Utility Classes

### Find & Remove:
- `className="p-4 m-2"` → Replace with `className="mk-p-4 mk-mb-2"`
- `className="text-white"` → Remove (inherited from body)
- `className="bg-gray-800"` → Replace with `className="mk-card"` or remove
- `className="rounded-lg"` → Remove (handled by mk-card)
- `className="shadow-md"` → Remove (handled by mk-card)

---

## Pattern 13: Color Overrides

### Find:
```
style={{color:'#fff'}}
```
### Replace:
```
REMOVE — inherited from body
```

### Find:
```
style={{color:'#888'}}
```
### Replace:
```
style="color: var(--mk-text-muted);"
```

### Find:
```
style={{color:'#aaa'}}
```
### Replace:
```
style="color: var(--mk-text-secondary);"
```

---

## Pattern 14: !important cleanup

### Find:
```css
.some-class {
  color: #fff !important;
}
```
### Replace:
```css
/* Remove !important — let the cascade work */
.some-class {
  color: var(--mk-text);
}
```

---

## Quick Checklist

After each replacement batch, verify:
- [ ] No `style={{` objects remain (except for CSS variable references)
- [ ] No `!important` in your CSS
- [ ] All screens wrapped in `.role-*` containers
- [ ] All `data-perm-*` attributes set
- [ ] Tables wrapped in `.mk-table-wrap`
- [ ] No old utility classes (Bootstrap/Tailwind atoms)
