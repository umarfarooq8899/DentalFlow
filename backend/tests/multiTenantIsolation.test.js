'use strict';


const request = require('supertest');
const app = require('../src/app');

/**
 * Helper: register a clinic + admin and return tokens.
 */
async function createClinicAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'Admin',
    lastName: 'User',
  });

  const loginRes = await request(app).post('/api/v1/auth/login').send({
    email,
    clinicSlug,
    password: 'Password123!',
  });

  return loginRes.body.data.accessToken;
}

describe('Multi-Tenant Isolation', () => {
  it('should isolate records between two clinics', async () => {
    const tokenA = await createClinicAndLogin('clinic-alpha', 'admin@alpha.com');
    const tokenB = await createClinicAndLogin('clinic-beta', 'admin@beta.com');

    // Clinic A creates a record
    const createRes = await request(app)
      .post('/api/v1/test-records')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Clinic A Record', description: 'Only A should see this' });

    expect(createRes.status).toBe(201);

    // Clinic A should see their record
    const listResA = await request(app)
      .get('/api/v1/test-records')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listResA.status).toBe(200);
    expect(listResA.body.data.length).toBe(1);
    expect(listResA.body.data[0].title).toBe('Clinic A Record');

    // Clinic B should see ZERO records (isolation)
    const listResB = await request(app)
      .get('/api/v1/test-records')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listResB.status).toBe(200);
    expect(listResB.body.data.length).toBe(0);
  });

  it('should scope clinicId correctly on created records', async () => {
    const tokenA = await createClinicAndLogin('clinic-gamma', 'admin@gamma.com');

    const createRes = await request(app)
      .post('/api/v1/test-records')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Gamma Record' });

    expect(createRes.status).toBe(201);
    // clinicId should be set on the record
    expect(createRes.body.data.clinicId).toBeDefined();
  });
});
