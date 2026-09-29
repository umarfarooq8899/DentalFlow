'use strict';

const request = require('supertest');
const app = require('../src/app');

// ─── Test Helpers ─────────────────────────────────────────────────────────────

async function registerAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'Admin',
    lastName: 'User',
  });
  const res = await request(app).post('/api/v1/auth/login').send({
    email,
    clinicSlug,
    password: 'Password123!',
  });
  return {
    token: res.body.data.accessToken,
    userId: res.body.data.user.id,
    clinicId: res.body.data.clinic.id,
  };
}

async function createDentist(authData) {
  const dentistRes = await request(app)
    .post('/api/v1/dentists')
    .set('Authorization', `Bearer ${authData.token}`)
    .send({
      userId: authData.userId,
      specialty: 'General Dentistry',
      licenseInfo: 'LIC-12345',
      workingHours: {
        timezone: 'UTC',
        weeklySchedule: [
          { dayOfWeek: 0, dayName: 'Sunday', isWorkingDay: false, workingPeriods: [] },
          { dayOfWeek: 1, dayName: 'Monday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 2, dayName: 'Tuesday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 3, dayName: 'Wednesday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 4, dayName: 'Thursday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 5, dayName: 'Friday', isWorkingDay: true, workingPeriods: [{ startTime: '09:00', endTime: '17:00' }] },
          { dayOfWeek: 6, dayName: 'Saturday', isWorkingDay: false, workingPeriods: [] },
        ],
      },
    });

  return dentistRes.body.data;
}

async function createPatient(token, name = 'John Doe') {
  const res = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      phone: '555-0100',
      email: `${name.toLowerCase().replace(/\s+/g, '')}@test.com`,
      gender: 'male',
      DOB: '1985-05-15',
    });
  return res.body.data;
}

describe('Appointments API — TASK 4', () => {
  let authA;
  let authB;
  let dentistA;
  let patientA;
  let patientA2;
  let dentistB;
  let patientB;

  // Next Monday at 10:00 UTC
  const targetDate = new Date();
  targetDate.setUTCDate(targetDate.getUTCDate() + ((1 + 7 - targetDate.getUTCDay()) % 7 || 7));
  targetDate.setUTCHours(10, 0, 0, 0);

  const startIso = targetDate.toISOString();
  const endIso = new Date(targetDate.getTime() + 60 * 60 * 1000).toISOString(); // 11:00 UTC
  const adjacentEndIso = new Date(targetDate.getTime() + 120 * 60 * 1000).toISOString(); // 12:00 UTC

  beforeEach(async () => {
    authA = await registerAndLogin('appt-clinic-a', 'admin-a@test.com');
    authB = await registerAndLogin('appt-clinic-b', 'admin-b@test.com');

    dentistA = await createDentist(authA);
    patientA = await createPatient(authA.token, 'Patient One');
    patientA2 = await createPatient(authA.token, 'Patient Two');

    dentistB = await createDentist(authB);
    patientB = await createPatient(authB.token, 'Patient Clinic B');
  });

  // ─── CREATE ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/appointments', () => {
    it('creates an appointment successfully and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
          notes: 'Routine checkup',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('scheduled');
      expect(res.body.data.patientId).toBe(patientA.id);
      expect(res.body.data.dentistId).toBe(dentistA.id);
      expect(res.body.data.notes).toBe('Routine checkup');
    });

    it('prevents double-booking (conflicting overlapping appointment returns 409)', async () => {
      // First booking: 10:00 - 11:00
      const first = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });
      expect(first.status).toBe(201);

      // Overlapping booking: 10:30 - 11:30
      const overlapStart = new Date(targetDate.getTime() + 30 * 60 * 1000).toISOString();
      const overlapEnd = new Date(targetDate.getTime() + 90 * 60 * 1000).toISOString();

      const second = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA2.id,
          dentistId: dentistA.id,
          startAt: overlapStart,
          endAt: overlapEnd,
        });

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('APPOINTMENT_CONFLICT');
    });

    it('allows adjacent appointments without overlap', async () => {
      // First booking: 10:00 - 11:00
      await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      // Adjacent booking: 11:00 - 12:00
      const adjacent = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA2.id,
          dentistId: dentistA.id,
          startAt: endIso,
          endAt: adjacentEndIso,
        });

      expect(adjacent.status).toBe(201);
      expect(adjacent.body.data.status).toBe('scheduled');
    });

    it('rejects booking outside dentist working hours (returns 400)', async () => {
      // Sunday or night time (02:00 UTC)
      const nightDate = new Date(targetDate);
      nightDate.setUTCHours(2, 0, 0, 0);

      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: nightDate.toISOString(),
          endAt: new Date(nightDate.getTime() + 60 * 60 * 1000).toISOString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('OUTSIDE_WORKING_HOURS');
    });

    it('rejects booking with patient from another clinic (tenant isolation)', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientB.id, // Belong to Clinic B
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      expect(res.status).toBe(404);
    });

    it('rejects booking with dentist from another clinic (tenant isolation)', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistB.id, // Belong to Clinic B
          startAt: startIso,
          endAt: endIso,
        });

      expect(res.status).toBe(404);
    });

    it('returns 400 when endAt is before startAt', async () => {
      const res = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: endIso,
          endAt: startIso,
        });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET ────────────────────────────────────────────────────────────────────

  describe('GET /api/v1/appointments/:id', () => {
    it('retrieves an appointment with populated fields', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      const res = await request(app)
        .get(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${authA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(created.body.data.id);
      expect(res.body.data.patientId.name).toBe('Patient One');
    });

    it('returns 404 when accessed by another clinic (tenant isolation)', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      const res = await request(app)
        .get(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${authB.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── UPDATE & STATUS TRANSITIONS ────────────────────────────────────────────

  describe('PATCH /api/v1/appointments/:id', () => {
    it('updates status and notes with valid transitions', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      // scheduled -> confirmed
      const res = await request(app)
        .patch(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          status: 'confirmed',
          notes: 'Patient confirmed via SMS',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('confirmed');
      expect(res.body.data.notes).toBe('Patient confirmed via SMS');
    });

    it('rejects invalid status transition (scheduled -> completed)', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      const res = await request(app)
        .patch(`/api/v1/appointments/${created.body.data.id}`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          status: 'completed',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ─── RESCHEDULE ─────────────────────────────────────────────────────────────

  describe('POST /api/v1/appointments/:id/reschedule', () => {
    it('reschedules an appointment to a new available slot', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      const newStart = new Date(targetDate.getTime() + 120 * 60 * 1000).toISOString();
      const newEnd = new Date(targetDate.getTime() + 180 * 60 * 1000).toISOString();

      const res = await request(app)
        .post(`/api/v1/appointments/${created.body.data.id}/reschedule`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          startAt: newStart,
          endAt: newEnd,
          notes: 'Rescheduled upon patient request',
        });

      expect(res.status).toBe(200);
      expect(new Date(res.body.data.startAt).toISOString()).toBe(newStart);
      expect(res.body.data.status).toBe('scheduled');
    });

    it('rejects rescheduling into a conflicting slot', async () => {
      // Appt 1: 10:00 - 11:00
      const appt1 = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      // Appt 2: 11:00 - 12:00
      await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA2.id,
          dentistId: dentistA.id,
          startAt: endIso,
          endAt: adjacentEndIso,
        });

      // Attempt to reschedule Appt 1 into Appt 2 slot
      const res = await request(app)
        .post(`/api/v1/appointments/${appt1.body.data.id}/reschedule`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          startAt: endIso,
          endAt: adjacentEndIso,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPOINTMENT_CONFLICT');
    });
  });

  // ─── CANCEL ─────────────────────────────────────────────────────────────────

  describe('POST /api/v1/appointments/:id/cancel', () => {
    it('cancels appointment and frees up the slot for a new booking', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      const cancelRes = await request(app)
        .post(`/api/v1/appointments/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          cancelReason: 'Patient feeling unwell',
        });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.status).toBe('cancelled');
      expect(cancelRes.body.data.cancelReason).toBe('Patient feeling unwell');

      // Now the freed slot can be booked by patientA2 without conflict
      const rebook = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA2.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      expect(rebook.status).toBe(201);
    });

    it('returns 400 when attempting to cancel an already cancelled appointment', async () => {
      const created = await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      await request(app)
        .post(`/api/v1/appointments/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({});

      const secondCancel = await request(app)
        .post(`/api/v1/appointments/${created.body.data.id}/cancel`)
        .set('Authorization', `Bearer ${authA.token}`)
        .send({});

      expect(secondCancel.status).toBe(400);
      expect(secondCancel.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });
  });

  // ─── LIST & FILTERS ─────────────────────────────────────────────────────────

  describe('GET /api/v1/appointments', () => {
    beforeEach(async () => {
      // Create 2 appointments in clinic A
      await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          startAt: startIso,
          endAt: endIso,
        });

      await request(app)
        .post('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`)
        .send({
          patientId: patientA2.id,
          dentistId: dentistA.id,
          startAt: endIso,
          endAt: adjacentEndIso,
        });
    });

    it('lists all appointments for clinic A with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${authA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination.total).toBe(2);
    });

    it('filters by patientId', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments?patientId=${patientA.id}`)
        .set('Authorization', `Bearer ${authA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].patientId.name).toBe('Patient One');
    });

    it('filters by dentistId', async () => {
      const res = await request(app)
        .get(`/api/v1/appointments?dentistId=${dentistA.id}`)
        .set('Authorization', `Bearer ${authA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it('enforces strict tenant isolation (clinic B sees 0 appointments)', async () => {
      const res = await request(app)
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${authB.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
      expect(res.body.pagination.total).toBe(0);
    });
  });
});
