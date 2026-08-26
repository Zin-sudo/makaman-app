// ============================================================
// MAKAMAN SUPPORT.JS — v2 Migration Integration
// Add these functions to your existing support.js
// ============================================================

// ─── PERMISSION INITIALIZATION ───

function initPermissions() {
  const perms = loadPermissions();
  if (perms) {
    applyAllPermissions(perms);
    validatePermissions(perms);
  }
}

// Call this when rendering ANY role screen
function renderWithPermissions(role) {
  const perms = loadPermissions();
  if (!perms) return;

  const wrapper = document.querySelector('.role-' + role);
  if (!wrapper) return;

  if (typeof PERM_ATTR_MAP !== 'undefined' && PERM_ATTR_MAP[role]) {
    Object.entries(PERM_ATTR_MAP[role]).forEach(([attr, permKey]) => {
      const roleKey = (role === 'ops') ? 'ops_manager' : role;
      const value = perms[roleKey]?.[permKey];
      if (value !== undefined) {
        wrapper.setAttribute(attr, value);
      }
    });
  }

  // Check for empty states
  checkEmptyStates(role, perms);
}

// ─── EMPTY STATE MANAGEMENT ───

function checkEmptyStates(role, perms) {
  if (role === 'observer') {
    const allCosmeticOff = [
      perms.observer?.can_view_live_activity,
      perms.observer?.can_view_approved_tickets,
      perms.observer?.can_view_revenue_stats,
      perms.observer?.can_view_technician_locations,
      perms.observer?.can_export_reports,
      perms.observer?.can_view_pending_tickets,
      perms.observer?.can_view_audit_trail
    ].every(v => v === false);

    const emptyEl = document.getElementById('observer-empty-state');
    const contentEls = document.querySelectorAll('.role-observer .live-activity-feed, .role-observer .approved-tickets-table, .role-observer .stats-grid, .role-observer .location-map');

    if (emptyEl) {
      if (allCosmeticOff) {
        emptyEl.style.display = 'block';
        contentEls.forEach(el => el.style.display = 'none');
      } else {
        emptyEl.style.display = 'none';
        contentEls.forEach(el => el.style.display = '');
      }
    }
  }

  if (role === 'technician') {
    // Show empty state if no tickets AND can't create
    const canCreate = perms.technician?.can_create_ticket;
    const hasTickets = document.querySelectorAll('.role-technician .mk-card').length > 1;
    const emptyEl = document.getElementById('tech-empty-state');

    if (emptyEl && !canCreate && !hasTickets) {
      emptyEl.style.display = 'block';
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }
  }
}

// ─── SYNC STATUS INDICATOR ───

function renderSyncStatus(status, count) {
  const icons = {
    synced: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
    pending: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    offline: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
  };

  const labels = {
    synced: 'Synced',
    pending: (count || 0) + ' pending',
    offline: 'Offline'
  };

  const classes = {
    synced: 'mk-badge-ok',
    pending: 'mk-badge-warn',
    offline: 'mk-badge-muted'
  };

  return '<span class="mk-badge ' + classes[status] + '">' + icons[status] + ' ' + labels[status] + '</span>';
}

function updateSyncStatus(elementId, status, count) {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = renderSyncStatus(status, count);
}

// ─── EMPTY STATE COMPONENTS ───

function renderEmptyState(type) {
  const configs = {
    observer: {
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
      title: 'No Data Available',
      message: 'All reporting features are disabled by the administrator.<br>Contact your admin to enable dashboard visibility.'
    },
    technician: {
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
      title: 'No Active Jobs',
      message: 'You have no assigned tickets. Wait for dispatch or contact your base.'
    },
    ops: {
      icon: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      title: 'No Pending Reviews',
      message: 'All tickets have been reviewed. Check approved tickets for history.'
    }
  };

  const config = configs[type] || configs.technician;

  return '<div class="mk-card mk-text-center" style="padding: var(--space-12);">' +
    '<div style="width: 64px; height: 64px; margin: 0 auto var(--space-4); background: var(--mk-elevated); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--mk-text-muted);">' + config.icon + '</div>' +
    '<h3 style="font-weight: 600; margin-bottom: var(--space-2);">' + config.title + '</h3>' +
    '<p style="color: var(--mk-text-muted); font-size: var(--text-sm);">' + config.message + '</p>' +
  '</div>';
}

// ─── STALLED TICKET ALERT ───

function renderStalledAlert(technicianName, baseName) {
  return '<div class="mk-card" style="border-color: #f59e0b; background: rgba(245,158,11,0.05);">' +
    '<div class="mk-flex mk-items-center mk-gap-3 mk-mb-3">' +
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>' +
      '<h3 style="color: #f59e0b; font-weight: 600;">⚠️ Technician Idle Alert</h3>' +
    '</div>' +
    '<p class="mk-text-sm mk-mb-3" style="color: var(--mk-text-secondary);">' +
      technicianName + ' has no active tickets and cannot create new ones (permission disabled). ' +
      'Assign tickets from the admin panel or enable ticket creation.' +
    '</p>' +
    '<div class="mk-flex mk-gap-2">' +
      '<button class="mk-btn mk-btn-sm mk-btn-secondary" onclick="assignTicket(\'' + technicianName + '\')">Assign Ticket</button>' +
      '<button class="mk-btn mk-btn-sm mk-btn-primary" onclick="enableCreation(\'' + technicianName + '\')">Enable Creation</button>' +
    '</div>' +
  '</div>';
}

function checkStalledTechnicians() {
  const perms = loadPermissions();
  if (!perms || perms.technician?.can_create_ticket !== false) return [];

  // Check each technician for idle state
  // Return array of stalled technician names
  // This is a hook — implement with your actual technician data
  return []; // Override with real logic
}

// ─── AUDIT TRAIL ───

function renderAuditTrail(events) {
  if (!events || events.length === 0) {
    return '<div class="mk-card"><h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: var(--space-4); color: var(--mk-text-secondary);">Audit Trail</h3><p class="mk-text-sm" style="color: var(--mk-text-muted);">No audit events recorded.</p></div>';
  }

  const items = events.map(function(ev) {
    return '<div style="padding: 10px 0; border-bottom: 1px solid var(--mk-border-subtle); font-size: 13px; color: var(--mk-text-secondary);">' +
      '<div class="mk-flex mk-justify-between">' +
        '<span style="color: var(--mk-text-primary);">' + ev.action + '</span>' +
        '<span style="color: var(--mk-text-muted); font-size: 11px;">' + ev.date + '</span>' +
      '</div>' +
      '<div style="color: var(--mk-text-muted);">' + ev.user + ' · ' + ev.location + '</div>' +
    '</div>';
  }).join('');

  return '<div class="mk-card">' +
    '<h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: var(--space-4); color: var(--mk-text-secondary);">Audit Trail</h3>' +
    '<div class="mk-flex mk-flex-col">' + items + '</div>' +
  '</div>';
}

// ─── CONFIRMATION MODAL ───

function showConfirmModal(title, message, onConfirm, onCancel) {
  const modal = document.getElementById('confirm-modal');
  const textEl = document.getElementById('confirm-text');

  if (textEl) textEl.innerHTML = message;
  if (modal) {
    modal.style.display = 'flex';
    modal.dataset.onConfirm = onConfirm ? 'true' : '';
    window._confirmCallback = onConfirm;
    window._cancelCallback = onCancel;
  }
}

function closeConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
  if (window._cancelCallback) window._cancelCallback();
}

function executeConfirm() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
  if (window._confirmCallback) window._confirmCallback();
}

// ─── UTILITY: CONVERT INLINE STYLES ───

// Run this once to auto-convert common patterns
function autoConvertStyles() {
  // Convert style objects to mk-* classes
  const conversions = [
    { selector: '[style*="background:#1d2d3d"]', className: 'mk-card' },
    { selector: '[style*="background:#c41e3a"]', className: 'mk-btn mk-btn-primary' },
    { selector: '[style*="display:flex"][style*="justifyContent:space-between"]', className: 'mk-flex mk-justify-between' },
    { selector: '[style*="display:flex"][style*="justifyContent:center"]', className: 'mk-flex mk-justify-center' },
    { selector: '[style*="display:flex"][style*="flexDirection:column"]', className: 'mk-flex mk-flex-col' },
  ];

  conversions.forEach(function(conv) {
    document.querySelectorAll(conv.selector).forEach(function(el) {
      el.classList.add(...conv.className.split(' '));
    });
  });

  console.log('[Makaman] Auto-conversion complete. Check console for remaining inline styles.');
}

// ─── BOOTSTRAP ───

// Call on app startup
document.addEventListener('DOMContentLoaded', function() {
  initPermissions();

  // Set initial sync status
  updateSyncStatus('tech-sync-status', 'synced');

  // Check for stalled technicians (admin only)
  if (document.querySelector('.role-admin')) {
    const stalled = checkStalledTechnicians();
    stalled.forEach(function(name) {
      console.log('[Admin] Stalled technician:', name);
    });
  }
});

// Expose globally
window.initPermissions = initPermissions;
window.renderWithPermissions = renderWithPermissions;
window.updateSyncStatus = updateSyncStatus;
window.renderSyncStatus = renderSyncStatus;
window.renderEmptyState = renderEmptyState;
window.renderStalledAlert = renderStalledAlert;
window.renderAuditTrail = renderAuditTrail;
window.showConfirmModal = showConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.executeConfirm = executeConfirm;
window.autoConvertStyles = autoConvertStyles;
