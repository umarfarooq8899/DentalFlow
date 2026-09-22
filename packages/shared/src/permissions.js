const { UserRole } = require('./roles');

const Permission = {
  // Patients
  PATIENTS_READ: 'patients:read',
  PATIENTS_WRITE: 'patients:write',
  PATIENTS_DELETE: 'patients:delete',

  // Appointments / Scheduling
  APPOINTMENTS_READ: 'appointments:read',
  APPOINTMENTS_WRITE: 'appointments:write',
  APPOINTMENTS_MANAGE: 'appointments:manage',

  // Clinical Records & Charts
  CHARTS_READ: 'charts:read',
  CHARTS_WRITE: 'charts:write',

  // Billing & Invoices
  BILLING_READ: 'billing:read',
  BILLING_WRITE: 'billing:write',

  // Staff & Roles
  STAFF_READ: 'staff:read',
  STAFF_MANAGE: 'staff:manage',
  ROLES_READ: 'roles:read',
  ROLES_MANAGE: 'roles:manage',

  // Dentists
  DENTISTS_READ: 'dentists:read',
  DENTISTS_MANAGE: 'dentists:manage',

  // Services
  SERVICES_READ: 'services:read',
  SERVICES_MANAGE: 'services:manage',

  // Clinic Settings
  CLINIC_MANAGE: 'clinic:manage',

  // Audit Logs
  AUDIT_READ: 'audit:read',

  // Test / System
  TEST_RECORDS_READ: 'test_records:read',
  TEST_RECORDS_WRITE: 'test_records:write',
  TEST_RECORDS_DELETE: 'test_records:delete',
};

const ALL_PERMISSIONS = Object.values(Permission);

const ROLE_PERMISSIONS = {
  [UserRole.SUPERADMIN]: ALL_PERMISSIONS,

  [UserRole.CLINIC_OWNER]: [
    Permission.PATIENTS_READ,
    Permission.PATIENTS_WRITE,
    Permission.PATIENTS_DELETE,
    Permission.APPOINTMENTS_READ,
    Permission.APPOINTMENTS_WRITE,
    Permission.APPOINTMENTS_MANAGE,
    Permission.CHARTS_READ,
    Permission.CHARTS_WRITE,
    Permission.BILLING_READ,
    Permission.BILLING_WRITE,
    Permission.STAFF_READ,
    Permission.STAFF_MANAGE,
    Permission.ROLES_READ,
    Permission.ROLES_MANAGE,
    Permission.DENTISTS_READ,
    Permission.DENTISTS_MANAGE,
    Permission.SERVICES_READ,
    Permission.SERVICES_MANAGE,
    Permission.CLINIC_MANAGE,
    Permission.AUDIT_READ,
    Permission.TEST_RECORDS_READ,
    Permission.TEST_RECORDS_WRITE,
    Permission.TEST_RECORDS_DELETE,
  ],

  [UserRole.DENTIST]: [
    Permission.PATIENTS_READ,
    Permission.PATIENTS_WRITE,
    Permission.APPOINTMENTS_READ,
    Permission.APPOINTMENTS_WRITE,
    Permission.APPOINTMENTS_MANAGE,
    Permission.CHARTS_READ,
    Permission.CHARTS_WRITE,
    Permission.BILLING_READ,
    Permission.STAFF_READ,
    Permission.TEST_RECORDS_READ,
    Permission.TEST_RECORDS_WRITE,
  ],

  [UserRole.HYGIENIST]: [
    Permission.PATIENTS_READ,
    Permission.PATIENTS_WRITE,
    Permission.APPOINTMENTS_READ,
    Permission.APPOINTMENTS_WRITE,
    Permission.CHARTS_READ,
    Permission.CHARTS_WRITE,
    Permission.TEST_RECORDS_READ,
  ],

  [UserRole.RECEPTIONIST]: [
    Permission.PATIENTS_READ,
    Permission.PATIENTS_WRITE,
    Permission.APPOINTMENTS_READ,
    Permission.APPOINTMENTS_WRITE,
    Permission.APPOINTMENTS_MANAGE,
    Permission.BILLING_READ,
    Permission.TEST_RECORDS_READ,
    Permission.TEST_RECORDS_WRITE,
  ],

  [UserRole.BILLING_STAFF]: [
    Permission.PATIENTS_READ,
    Permission.BILLING_READ,
    Permission.BILLING_WRITE,
    Permission.APPOINTMENTS_READ,
    Permission.TEST_RECORDS_READ,
  ],

  [UserRole.STAFF]: [
    Permission.PATIENTS_READ,
    Permission.APPOINTMENTS_READ,
  ],
};

ROLE_PERMISSIONS[UserRole.CLINIC_ADMIN] = ROLE_PERMISSIONS[UserRole.CLINIC_OWNER];

module.exports = {
  Permission,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
};
