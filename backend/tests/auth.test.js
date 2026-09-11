'use strict';


const request = require('supertest');
const app = require('../src/app');

describe('Auth API', () => {
  const clinic = { clinicName: 'Test Clinic', clinicSlug: 'test-clinic' };
  const adminUser = {
    email: 'admin@test.com',
    password: 'Password123!',
    firstName: 'Admin',
    lastName: 'User',
  };

  describe('POST /api/v1/auth/register', () => {
    it('should register a clinic and admin user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.clinic.slug).toBe('test-clinic');
      expect(res.body.data.user.role).toBe('clinic_admin');
    });

    it('should reject duplicate clinic slug', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser, email: 'other@test.com' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, clinicSlug: clinic.clinicSlug, password: adminUser.password });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('should reject invalid password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, clinicSlug: clinic.clinicSlug, password: 'wrongpass' });

      expect(res.status).toBe(401);
    });

    it('should reject wrong clinic', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, clinicSlug: 'wrong-clinic', password: adminUser.password });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, clinicSlug: clinic.clinicSlug, password: adminUser.password });

      refreshToken = loginRes.body.data.refreshToken;
    });

    it('should issue new tokens from valid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      // New refresh token should differ from old
      expect(res.body.data.refreshToken).not.toBe(refreshToken);
    });

    it('should reject a reused refresh token', async () => {
      // First use
      await request(app).post('/api/v1/auth/refresh').send({ refreshToken });

      // Second use — should be rejected (token was revoked on rotation)
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    let accessToken;

    beforeEach(async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({ ...clinic, ...adminUser });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminUser.email, clinicSlug: clinic.clinicSlug, password: adminUser.password });

      accessToken = loginRes.body.data.accessToken;
    });

    it('should return current user info', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe('clinic_admin');
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
