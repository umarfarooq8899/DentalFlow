'use strict';

const { Router } = require('express');
const {
  createAppointmentHandler,
  getAppointmentHandler,
  updateAppointmentHandler,
  rescheduleAppointmentHandler,
  cancelAppointmentHandler,
  listAppointmentsHandler,
} = require('../../controllers/appointmentController');
const { authenticate } = require('../../middlewares/authenticate');
const { tenantMiddleware } = require('../../multitenancy/tenantMiddleware');
const { requirePermission } = require('../../middlewares/requirePermission');
const { Permission } = require('@dentalflow/shared');

const router = Router();

router.use(authenticate, tenantMiddleware);

// ─── Appointment CRUD ─────────────────────────────────────────────────────────
router.post('/', requirePermission(Permission.APPOINTMENTS_WRITE), createAppointmentHandler);
router.get('/', requirePermission(Permission.APPOINTMENTS_READ), listAppointmentsHandler);
router.get('/:id', requirePermission(Permission.APPOINTMENTS_READ), getAppointmentHandler);
router.patch('/:id', requirePermission(Permission.APPOINTMENTS_WRITE), updateAppointmentHandler);

// ─── Reschedule & Cancel ──────────────────────────────────────────────────────
router.post('/:id/reschedule', requirePermission(Permission.APPOINTMENTS_MANAGE), rescheduleAppointmentHandler);
router.post('/:id/cancel', requirePermission(Permission.APPOINTMENTS_WRITE), cancelAppointmentHandler);

module.exports = router;
