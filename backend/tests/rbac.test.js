'use strict';


const request = require('supertest');
const app = require('../src/app');

describe('RBAC Middleware', () => {
  const clinic = { clinicName: 'RBAC Clinic', clinicSlug: 'rbac-clinic' };
  const adminUser = {
    email: 'admin@rbac.com',
    password: 'Password123!',
    firstName: 'Admin',
    lastName: 'RBAC',
  };

  let accessToken;

  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send({ ...clinic, ...adminUser });

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, clinicSlug: clinic.clinicSlug, password: adminUser.password });

    accessToken = loginRes.body.data.accessToken;
  });

  it('should allow clinic_admin to access protected routes', async () => {
    const res = await request(app)
      .get('/api/v1/test-records')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
  });

  it('should reject requests without a token', async () => {
    const res = await request(app).get('/api/v1/test-records');
    expect(res.status).toBe(401);
  });

  it('should reject requests with an invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/test-records')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });
});
