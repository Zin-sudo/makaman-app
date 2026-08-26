// ============================================================
// MAKAMAN PERMISSIONS SYSTEM v2
// Role-based feature toggles with locked workflow safeguards
// ============================================================

const PERMISSION_TIERS = {
  mandatory: {
    technician: ['can_mark_done', 'can_sync_to_cloud'],
    ops_manager: ['can_approve_tickets', 'can_assign_ticket_numbers']
  },
  workflow: {
    technician: ['can_create_ticket', 'can_edit_job_log', 'can_capture_gps', 'can_add_attachments'],
    ops_manager: ['can_edit_charged_items', 'can_edit_timestamps', 'can_apply_discounts', 'can_export_data', 'can_reopen_tickets']
  },
  cosmetic: {
    technician: ['can_view_history', 'can_view_pricing', 'can_edit_customer_info'],
    ops_manager: ['can_remove_surcharges', 'can_preview_sheets', 'can_view_all_bases'],
    observer: ['can_view_live_activity', 'can_view_approved_tickets', 'can_view_revenue_stats', 'can_view_technician_locations', 'can_export_reports', 'can_view_pending_tickets', 'can_view_audit_trail']
  }
};

const DEFAULT_PERMISSIONS = {
  technician: {
    can_mark_done: true,
    can_sync_to_cloud: true,
    can_create_ticket: true,
    can_edit_job_log: true,
    can_capture_gps: true,
    can_add_attachments: true,
    can_view_history: true,
    can_view_pricing: false,
    can_edit_customer_info: false
  },
  ops_manager: {
    can_approve_tickets: true,
    can_assign_ticket_numbers: true,
    can_edit_charged_items: true,
    can_edit_timestamps: true,
    can_apply_discounts: true,
    can_export_data: true,
    can_reopen_tickets: true,
    can_remove_surcharges: false,
    can_preview_sheets: true,
    can_view_all_bases: false
  },
  observer: {
    can_view_live_activity: true,
    can_view_approved_tickets: true,
    can_view_revenue_stats: true,
    can_view_technician_locations: true,
    can_export_reports: true,
    can_view_pending_tickets: false,
    can_view_audit_trail: false
  }
};

const PERM_ATTR_MAP = {
  technician: {
    'data-perm-create': 'can_create_ticket',
    'data-perm-edit-log': 'can_edit_job_log',
    'data-perm-done': 'can_mark_done',
    'data-perm-gps': 'can_capture_gps',
    'data-perm-sync': 'can_sync_to_cloud',
    'data-perm-history': 'can_view_history',
    'data-perm-attachments': 'can_add_attachments',
    'data-perm-edit-customer': 'can_edit_customer_info',
    'data-perm-pricing': 'can_view_pricing'
  },
  ops: {
    'data-perm-approve': 'can_approve_tickets',
    'data-perm-edit-timestamps': 'can_edit_timestamps',
    'data-perm-assign-number': 'can_assign_ticket_numbers',
    'data-perm-discount': 'can_apply_discounts',
    'data-perm-remove-surcharge': 'can_remove_surcharges',
    'data-perm-preview': 'can_preview_sheets',
    'data-perm-export': 'can_export_data',
    'data-perm-reopen': 'can_reopen_tickets',
    'data-perm-all-bases': 'can_view_all_bases',
    'data-perm-edit-items': 'can_edit_charged_items'
  },
  observer: {
    'data-perm-live': 'can_view_live_activity',
    'data-perm-approved': 'can_view_approved_tickets',
    'data-perm-stats': 'can_view_revenue_stats',
    'data-perm-locations': 'can_view_technician_locations',
    'data-perm-export-reports': 'can_export_reports',
    'data-perm-pending': 'can_view_pending_tickets',
    'data-perm-audit': 'can_view_audit_trail'
  }
};

function applyPermissions(role, permissions) {
  const wrapper = document.querySelector('.role-' + role);
  if (!wrapper || !permissions) return;
  const attrMap = PERM_ATTR_MAP[role];
  if (attrMap) {
    Object.entries(attrMap).forEach(function(entry) {
      const value = permissions[entry[1]];
      if (value !== undefined) wrapper.setAttribute(entry[0], value);
    });
  }
}

function applyAllPermissions(permissionsState) {
  if (!permissionsState) return;
  Object.keys(permissionsState).forEach(function(role) {
    applyPermissions(role === 'ops_manager' ? 'ops' : role, permissionsState[role]);
  });
}

function validatePermissions(permissionsState) {
  if (!permissionsState) return [];
  const warnings = [];
  const tech = permissionsState.technician || {};
  const ops = permissionsState.ops_manager || {};
  if (!tech.can_mark_done && !ops.can_approve_tickets) {
    warnings.push('CRITICAL: Technicians cannot mark jobs done AND Ops Managers cannot approve. Tickets will stall forever.');
  }
  if (!ops.can_assign_ticket_numbers && ops.can_approve_tickets) {
    warnings.push('WARNING: Ops Managers can approve but cannot assign ticket numbers. Invoicing will break.');
  }
  if (!tech.can_create_ticket) {
    warnings.push('NOTICE: Technicians cannot create new tickets. Ensure pre-assigned tickets exist.');
  }
  const banner = document.getElementById('perm-warning');
  if (banner) {
    if (warnings.length > 0) {
      banner.style.display = 'flex';
      const span = banner.querySelector('span');
      if (span) span.textContent = warnings[0];
    } else {
      banner.style.display = 'none';
    }
  }
  return warnings;
}

function getPermissionTier(role, permKey) {
  if (PERMISSION_TIERS.mandatory[role] && PERMISSION_TIERS.mandatory[role].includes(permKey)) return 'mandatory';
  if (PERMISSION_TIERS.workflow[role] && PERMISSION_TIERS.workflow[role].includes(permKey)) return 'workflow';
  if (PERMISSION_TIERS.cosmetic[role] && PERMISSION_TIERS.cosmetic[role].includes(permKey)) return 'cosmetic';
  return null;
}

function isPermissionLocked(role, permKey) {
  return getPermissionTier(role, permKey) === 'mandatory';
}

function savePermissions(permissionsState) {
  try {
    localStorage.setItem('makaman_permissions', JSON.stringify(permissionsState));
    return true;
  } catch (e) {
    console.error('Failed to save permissions:', e);
    return false;
  }
}

function loadPermissions() {
  try {
    const saved = localStorage.getItem('makaman_permissions');
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load permissions:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
}

function resetPermissions() {
  return JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_PERMISSIONS, PERMISSION_TIERS, PERM_ATTR_MAP,
    applyPermissions, applyAllPermissions, validatePermissions,
    getPermissionTier, isPermissionLocked, savePermissions, loadPermissions, resetPermissions
  };
}
