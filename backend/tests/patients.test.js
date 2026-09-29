'use strict';

const request = require('supertest');
const app = require('../src/app');

// ─── Test Helpers ──────────────────────────────────────────────────────────────

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
  return res.body.data.accessToken;
}

const basePatient = {
  name: 'Jane Doe',
  phone: '555-1234',
  email: 'jane@example.com',
  DOB: '1990-06-15',
  gender: 'female',
};

describe('Patients API — TASK 3', () => {
  let tokenA;
  let tokenB;

  beforeEach(async () => {
    tokenA = await registerAndLogin('clinic-patients-a', 'admin-a@test.com');
    tokenB = await registerAndLogin('clinic-patients-b', 'admin-b@test.com');
  });

  // ─── CREATE ────────────────────────────────────────────────────────────────

  describe('POST /api/v1/patients', () => {
    it('creates a patient and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(basePatient);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Jane Doe');
      expect(res.body.data.patientNo).toMatch(/^PT-\d{5}$/);
      expect(res.body.data.status).toBe('active');
    });

    it('auto-increments patientNo per clinic', async () => {
      const r1 = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...basePatient, name: 'Pat One' });
      const r2 = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...basePatient, name: 'Pat Two', email: 'two@example.com' });

      expect(r1.body.data.patientNo).toBe('PT-00001');
      expect(r2.body.data.patientNo).toBe('PT-00002');
    });

    it('returns 400 if name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: '555-0000' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await request(app).post('/api/v1/patients').send(basePatient);
      expect(res.status).toBe(401);
    });
  });

  // ─── READ ─────────────────────────────────────────────────────────────────

  describe('GET /api/v1/patients/:id', () => {
    let patientId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(basePatient);
      patientId = res.body.data.id;
    });

    it('retrieves a patient by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(patientId);
    });

    it('returns 404 for a patient in another clinic (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });

    it('returns 404 for a non-existent patient', async () => {
      const res = await request(app)
        .get('/api/v1/patients/000000000000000000000000')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── UPDATE ────────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/patients/:id', () => {
    let patientId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(basePatient);
      patientId = res.body.data.id;
    });

    it('updates allowed fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: '999-9999', gender: 'other' });

      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe('999-9999');
      expect(res.body.data.gender).toBe('other');
    });

    it('blocks cross-clinic update (tenant isolation)', async () => {
      const res = await request(app)
        .patch(`/api/v1/patients/${patientId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ phone: 'hacked' });

      expect(res.status).toBe(404);
    });
  });

  // ─── ARCHIVE (soft delete) ─────────────────────────────────────────────────

  describe('POST /api/v1/patients/:id/archive', () => {
    let patientId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(basePatient);
      patientId = res.body.data.id;
    });

    it('archives a patient (soft delete)', async () => {
      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('archived');
      expect(res.body.data.archivedAt).toBeTruthy();
    });

    it('returns 409 when archiving an already-archived patient', async () => {
      await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(409);
    });

    it('archived patient is excluded from default list', async () => {
      await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((p) => p.id);
      expect(ids).not.toContain(patientId);
    });

    it('archived patient appears with includeArchived=true', async () => {
      await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      const res = await request(app)
        .get('/api/v1/patients?includeArchived=true')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((p) => p.id);
      expect(ids).toContain(patientId);
    });

    it('can unarchive a patient', async () => {
      await request(app)
        .post(`/api/v1/patients/${patientId}/archive`)
        .set('Authorization', `Bearer ${tokenA}`);

      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/unarchive`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.archivedAt).toBeNull();
    });
  });

  // ─── SEARCH & PAGINATION ────────────────────────────────────────────────────

  describe('GET /api/v1/patients (search, filter, pagination)', () => {
    beforeEach(async () => {
      const patients = [
        { name: 'Alice Smith', phone: '111-1111', email: 'alice@example.com' },
        { name: 'Bob Jones', phone: '222-2222', email: 'bob@example.com' },
        { name: 'Charlie Brown', phone: '333-3333', email: 'charlie@example.com' },
      ];
      for (const p of patients) {
        await request(app)
          .post('/api/v1/patients')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(p);
      }
    });

    it('lists all active patients with pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(3);
      expect(res.body.pagination.total).toBe(3);
    });

    it('searches by name', async () => {
      const res = await request(app)
        .get('/api/v1/patients?search=alice')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Alice Smith');
    });

    it('searches by email', async () => {
      const res = await request(app)
        .get('/api/v1/patients?search=bob@example.com')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Bob Jones');
    });

    it('searches by phone', async () => {
      const res = await request(app)
        .get('/api/v1/patients?search=333-3333')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });

    it('paginates correctly', async () => {
      const res = await request(app)
        .get('/api/v1/patients?page=1&limit=2')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it('returns empty for a different clinic (tenant isolation)', async () => {
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(0);
    });

    it('sorts by name ascending', async () => {
      const res = await request(app)
        .get('/api/v1/patients?sortBy=name&sortOrder=asc')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const names = res.body.data.map((p) => p.name);
      expect(names).toEqual([...names].sort());
    });
  });

  // ─── MEDICAL ALERTS ────────────────────────────────────────────────────────

  describe('Medical Alerts', () => {
    let patientId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(basePatient);
      patientId = res.body.data.id;
    });

    it('adds a structured medical alert', async () => {
      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/medical-alerts`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'allergy', description: 'Penicillin', severity: 'critical' });

      expect(res.status).toBe(201);
      expect(res.body.data.medicalAlerts.length).toBe(1);
      expect(res.body.data.medicalAlerts[0].severity).toBe('critical');
      expect(res.body.data.medicalAlerts[0].verifiedAt).toBeTruthy();
    });

    it('validates alert schema (missing description)', async () => {
      const res = await request(app)
        .post(`/api/v1/patients/${patientId}/medical-alerts`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'allergy', severity: 'low' });

      expect(res.status).toBe(400);
    });

    it('removes a medical alert', async () => {
      const addRes = await request(app)
        .post(`/api/v1/patients/${patientId}/medical-alerts`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'allergy', description: 'Aspirin', severity: 'medium' });

      const alertId = addRes.body.data.medicalAlerts[0]._id;

      const delRes = await request(app)
        .delete(`/api/v1/patients/${patientId}/medical-alerts/${alertId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.medicalAlerts.length).toBe(0);
    });
  });
});
