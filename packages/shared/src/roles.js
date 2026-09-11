const UserRole = {
  SUPERADMIN: 'superadmin',
  CLINIC_OWNER: 'clinic_owner',
  DENTIST: 'dentist',
  HYGIENIST: 'hygienist',
  RECEPTIONIST: 'receptionist',
  BILLING_STAFF: 'billing_staff',
};

const ALL_ROLES = Object.values(UserRole);

module.exports = {
  UserRole,
  ALL_ROLES,
};
