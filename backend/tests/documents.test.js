'use strict';

const request = require('supertest');

// ─── Mock S3 before any app import ────────────────────────────────────────────
// Documents depend on S3; we mock the integration so tests don't require
// real AWS credentials.
jest.mock('../src/integrations/s3Storage', () => ({
  generateUploadUrl: jest.fn().mockResolvedValue('https://s3.example.com/upload?signed=1'),
  generateDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/download?signed=1'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  objectExists: jest.fn().mockResolvedValue(true),
  buildObjectKey: jest.fn((clinicId, patientId, type, name) =>
    `${clinicId}/patients/${patientId}/${type}/${name}`
  ),
}));

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
    .send({ name: 'Doc Patient', ...overrides });
  return res.body.data;
}

const validUploadPayload = (patientId) => ({
  patientId,
  type: 'xray',
  filename: 'xray-001.jpg',
  mimeType: 'image/jpeg',
  size: 1024 * 512, // 512 KB
});

describe('Documents API — TASK 3', () => {
  let tokenA;
  let tokenB;
  let patientA;

  beforeEach(async () => {
    tokenA = await registerAndLogin('clinic-docs-a', 'admin-docs-a@test.com');
    tokenB = await registerAndLogin('clinic-docs-b', 'admin-docs-b@test.com');
    patientA = await createPatient(tokenA);
  });

  // ─── Initiate Upload ──────────────────────────────────────────────────────

  describe('POST /api/v1/documents/upload-url', () => {
    it('returns a signed upload URL and documentId', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validUploadPayload(patientA.id));

      expect(res.status).toBe(201);
      expect(res.body.data.uploadUrl).toContain('signed=1');
      expect(res.body.data.documentId).toBeDefined();
      // storageKey must NOT be in the response
      expect(res.body.data.storageKey).toBeUndefined();
    });

    it('rejects invalid MIME type', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...validUploadPayload(patientA.id), mimeType: 'application/exe' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MIME_TYPE');
    });

    it('rejects files exceeding 50 MB', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...validUploadPayload(patientA.id), size: 60 * 1024 * 1024 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects patient from another clinic (ownership check)', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenB}`)
        .send(validUploadPayload(patientA.id));

      expect(res.status).toBe(404);
    });

    it('returns 401 for unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .send(validUploadPayload(patientA.id));

      expect(res.status).toBe(401);
    });

    it('rejects invalid document type', async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...validUploadPayload(patientA.id), type: 'invoice' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Download URL ─────────────────────────────────────────────────────────

  describe('GET /api/v1/documents/:documentId/download-url', () => {
    let documentId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validUploadPayload(patientA.id));
      documentId = res.body.data.documentId;
    });

    it('returns a signed download URL', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${documentId}/download-url`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.downloadUrl).toContain('signed=1');
      // storageKey must NOT be in the response
      expect(res.body.data.storageKey).toBeUndefined();
    });

    it('returns 404 when accessed by a different clinic (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${documentId}/download-url`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── Get Metadata ─────────────────────────────────────────────────────────

  describe('GET /api/v1/documents/:documentId', () => {
    let documentId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validUploadPayload(patientA.id));
      documentId = res.body.data.documentId;
    });

    it('returns document metadata without storageKey', async () => {
      const res = await request(app)
        .get(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.filename).toBe('xray-001.jpg');
      expect(res.body.data.mimeType).toBe('image/jpeg');
      // storageKey must never be in API response
      expect(res.body.data.storageKey).toBeUndefined();
    });
  });

  // ─── Delete ───────────────────────────────────────────────────────────────

  describe('DELETE /api/v1/documents/:documentId', () => {
    let documentId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validUploadPayload(patientA.id));
      documentId = res.body.data.documentId;
    });

    it('deletes document (admin can always delete)', async () => {
      const res = await request(app)
        .delete(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
    });

    it('cannot delete document from another clinic', async () => {
      const res = await request(app)
        .delete(`/api/v1/documents/${documentId}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── List Patient Documents ───────────────────────────────────────────────

  describe('GET /api/v1/patients/:patientId/documents', () => {
    it('lists documents for a patient', async () => {
      await request(app)
        .post('/api/v1/documents/upload-url')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validUploadPayload(patientA.id));

      const res = await request(app)
        .get(`/api/v1/patients/${patientA.id}/documents`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      // No storageKey in list response
      expect(res.body.data[0].storageKey).toBeUndefined();
    });

    it('clinic B cannot list clinic A documents', async () => {
      const res = await request(app)
        .get(`/api/v1/patients/${patientA.id}/documents`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(404);
    });
  });
});
