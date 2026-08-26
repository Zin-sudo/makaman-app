// ============================================================
// Makaman Migration Helper
// Run this in browser console to audit your current markup
// ============================================================

const MigrationHelper = {
  // Find all inline styles
  findInlineStyles() {
    const elements = document.querySelectorAll('[style]');
    const results = [];
    elements.forEach(el => {
      if (el.getAttribute('style').trim()) {
        results.push({
          tag: el.tagName,
          class: el.className,
          style: el.getAttribute('style'),
          html: el.outerHTML.substring(0, 200)
        });
      }
    });
    console.table(results);
    console.log(`Found ${results.length} elements with inline styles`);
    return results;
  },

  // Find old utility classes (Bootstrap/Tailwind patterns)
  findOldUtilities() {
    const patterns = [
      /^p-\d+$/, /^m\d*-\d+$/, /^px-\d+$/, /^py-\d+$/, /^mx-\d+$/, /^my-\d+$/,
      /^text-\w+$/, /^bg-\w+$/, /^rounded-\w*$/, /^shadow-\w*$/,
      /^flex$/, /^block$/, /^hidden$/, /^grid$/,
      /^col-\d+$/, /^row$/, /^container$/,
      /^btn$/, /^btn-\w+$/, /^form-control$/, /^form-select$/,
      /^table$/, /^table-\w*$/
    ];

    const allElements = document.querySelectorAll('*');
    const offenders = [];

    allElements.forEach(el => {
      const classes = el.className.split(/\s+/);
      classes.forEach(cls => {
        if (patterns.some(p => p.test(cls))) {
          offenders.push({
            tag: el.tagName,
            class: cls,
            fullClass: el.className,
            html: el.outerHTML.substring(0, 150)
          });
        }
      });
    });

    console.table(offenders);
    console.log(`Found ${offenders.length} old utility classes`);
    return offenders;
  },

  // Check role wrappers
  checkRoleWrappers() {
    const roles = ['technician', 'ops', 'admin', 'observer'];
    const results = {};

    roles.forEach(role => {
      const wrapper = document.querySelector(`.role-${role}`);
      results[role] = {
        found: !!wrapper,
        dataPermCount: wrapper ? Object.keys(wrapper.dataset).filter(k => k.startsWith('perm')).length : 0,
        hasContainer: wrapper ? !!wrapper.querySelector('.mk-container') : false,
        hasNavbar: wrapper ? !!wrapper.querySelector('.mk-navbar') : false
      };
    });

    console.table(results);
    return results;
  },

  // Check for mk-* classes usage
  checkMkClasses() {
    const mkElements = document.querySelectorAll('[class*="mk-"]');
    const counts = {};

    mkElements.forEach(el => {
      const classes = el.className.split(/\s+/);
      classes.forEach(cls => {
        if (cls.startsWith('mk-')) {
          counts[cls] = (counts[cls] || 0) + 1;
        }
      });
    });

    console.table(counts);
    console.log(`Found ${Object.keys(counts).length} unique mk-* classes`);
    return counts;
  },

  // Full audit
  audit() {
    console.log('=== MAKAMAN MIGRATION AUDIT ===');
    console.log('');
    console.log('1. Inline Styles:');
    this.findInlineStyles();
    console.log('');
    console.log('2. Old Utility Classes:');
    this.findOldUtilities();
    console.log('');
    console.log('3. Role Wrappers:');
    this.checkRoleWrappers();
    console.log('');
    console.log('4. mk-* Classes:');
    this.checkMkClasses();
    console.log('');
    console.log('=== END AUDIT ===');
  }
};

// Expose globally
window.MigrationHelper = MigrationHelper;

// Auto-run audit on load if in debug mode
if (window.location.hash === '#audit') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => MigrationHelper.audit(), 500);
  });
}
