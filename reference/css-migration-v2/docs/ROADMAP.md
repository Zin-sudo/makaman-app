# Makaman Migration — Implementation Roadmap

## Step 1: Drop These Files Into Your Project
Copy all files from `app/` into your existing PWA `app/` folder.

## Step 2: Merge index.html
- Open YOUR `app/index.html`
- Copy the `<style>` block from `app/index.html` (the Makaman CSS) into YOUR `<head>`
- Add `<script src="permissions.js"></script>` before `support.js`
- Wrap your screens in `.role-*` containers (see `migrations/BATCH2_FIND_REPLACE_GUIDE.md`)

## Step 3: Merge support.js
- Open YOUR `app/support.js`
- Append ALL functions from the package `app/support.js` to your file

## Step 4: Replace Inline Styles
- Use `migrations/BATCH2_FIND_REPLACE_GUIDE.md` — work through patterns 1-14
- Use `migrations/COMPONENT_EXAMPLES.html` as copy-paste reference

## Step 5: Wire Permissions
- Call `renderWithPermissions('technician')` before rendering technician screens
- Call `renderWithPermissions('ops')` before rendering ops screens
- Call `renderWithPermissions('observer')` before rendering observer screens

## Step 6: Test
- Open in browser
- Add `#audit` to URL and check console
- Test all breakpoints: 375px, 768px, 1024px, 1440px
- Toggle permissions in admin page

## Done
Upload any broken files to the next chat for fixes.
