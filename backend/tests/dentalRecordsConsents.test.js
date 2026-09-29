'use strict';

const request = require('supertest');
const app = require('../src/app');

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

async function createPatient(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test Patient', ...overrides });
  return res.body.data;
}

describe('Dental Records API — TASK 3', () => {
  let tokenA;
  let tokenB;
  let patientA;

  beforeEach(async () => {
    tokenA = await registerAndLogin('clinic-dr-a', 'admin-dr-a@test.com');
    tokenB = await registerAndLogin('clinic-dr-b', 'admin-dr-b@test.com');
    patientA = await createPatient(tokenA);
  });

  describe('GET /api/v1/dental-records/:patientId', () => {
    it('auto-creates a dental record on first access', async () => {
      const res = await request(app)
        .get(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.patientId).toBe(patientA.id);
    });

    it('returns 404 for patient in another clinic', async () => {
      const res = await request(app)
        .get(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/dental-records/:patientId', () => {
    it('updates dental record fields', async () => {
      const res = await request(app)
        .patch(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ allergies: 'Latex', medicalHistory: 'Hypertension' });

      expect(res.status).toBe(200);
      expect(res.body.data.allergies).toBe('Latex');
      expect(res.body.data.medicalHistory).toBe('Hypertension');
    });

    it('appends notes preserving history (does not overwrite)', async () => {
      await request(app)
        .patch(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ notes: 'First entry' });

      const res = await request(app)
        .patch(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ notes: 'Second entry' });

      expect(res.status).toBe(200);
      // Both entries should be present
      expect(res.body.data.notes).toContain('First entry');
      expect(res.body.data.notes).toContain('Second entry');
    });

    it('blocks cross-clinic update', async () => {
      const res = await request(app)
        .patch(`/api/v1/dental-records/${patientA.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ notes: 'Hacked' });

      expect(res.status).toBe(404);
    });
  });
});

// ─── Consents ─────────────────────────────────────────────────────────────────

describe('Consents API — TASK 3', () => {
  let token;
  let patient;
  let templateId;

  beforeEach(async () => {
    token = await registerAndLogin('clinic-consent', 'admin-consent@test.com');
    patient = await createPatient(token);

    // Create a consent template
    const tRes = await request(app)
      .post('/api/v1/consents/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'treatment', title: 'Treatment Consent v1', content: 'I agree to treatment.' });

    templateId = tRes.body.data.id;
  });

  describe('POST /api/v1/consents/templates', () => {
    it('creates a consent template at version 1', async () => {
      const res = await request(app)
        .get('/api/v1/consents/templates')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].version).toBe(1);
      expect(res.body.data[0].isActive).toBe(true);
    });

    it('increments version and deactivates old version', async () => {
      await request(app)
        .post('/api/v1/consents/templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'treatment', title: 'Treatment Consent v2', content: 'Updated terms.' });

      const res = await request(app)
        .get('/api/v1/consents/templates')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const templates = res.body.data;
      const v2 = templates.find((t) => t.version === 2);
      const v1 = templates.find((t) => t.version === 1);
      expect(v2.isActive).toBe(true);
      expect(v1.isActive).toBe(false);
    });

    it('returns 400 if required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/consents/templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'treatment' }); // missing title and content

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/consents', () => {
    it('records a signed consent form', async () => {
      const res = await request(app)
        .post('/api/v1/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          patientId: patient.id,
          templateId,
          signedByName: 'Jane Doe',
          signedAt: new Date().toISOString(),
          method: 'digital',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.templateVersion).toBe(1);
      expect(res.body.data.signedByName).toBe('Jane Doe');
      // Content snapshot must be captured for archival
      expect(res.body.data.contentSnapshot).toBe('I agree to treatment.');
    });

    it('immutable consent — cannot update via PATCH (no update route)', async () => {
      const createRes = await request(app)
        .post('/api/v1/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          patientId: patient.id,
          templateId,
          signedByName: 'Jane Doe',
          signedAt: new Date().toISOString(),
          method: 'paper',
        });

      const consentId = createRes.body.data.id;

      // No PATCH /api/v1/consents/:id route exists
      const patchRes = await request(app)
        .patch(`/api/v1/consents/${consentId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ signedByName: 'Tampered Name' });

      expect(patchRes.status).toBe(404); // Route doesn't exist → 404
    });

    it('signed consent references correct template version', async () => {
      // Create v2 of template
      await request(app)
        .post('/api/v1/consents/templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'treatment', title: 'v2', content: 'New content.' });

      // Sign against v1 template
      const res = await request(app)
        .post('/api/v1/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          patientId: patient.id,
          templateId,
          signedByName: 'Patient',
          signedAt: new Date().toISOString(),
          method: 'digital',
        });

      expect(res.status).toBe(201);
      // Must snapshot the v1 content, not v2
      expect(res.body.data.contentSnapshot).toBe('I agree to treatment.');
      expect(res.body.data.templateVersion).toBe(1);
    });
  });

  describe('GET /api/v1/patients/:patientId/consents', () => {
    it('lists consents for a patient', async () => {
      await request(app)
        .post('/api/v1/consents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          patientId: patient.id,
          templateId,
          signedByName: 'Jane',
          signedAt: new Date().toISOString(),
          method: 'digital',
        });

      const res = await request(app)
        .get(`/api/v1/patients/${patient.id}/consents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });
  });
});
