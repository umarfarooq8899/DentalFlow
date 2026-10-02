'use strict';

const request = require('supertest');
const app = require('../src/app');
const DentalChart = require('../src/models/DentalChart');
const {
  toCents,
  addCents,
  subtractCents,
  centsToDecimalString,
} = require('../src/utils/money');

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
    user: res.body.data.user,
  };
}

async function createDentist(authData, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/dentists')
    .set('Authorization', `Bearer ${authData.token}`)
    .send({
      userId: authData.userId,
      specialty: 'General Dentistry',
      licenseInfo: 'DENT-12345',
      ...overrides,
    });
  return res.body.data;
}

async function createPatient(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Jane Patient', ...overrides });
  return res.body.data;
}

describe('TASK 5 — Dental Chart, Treatment Plans & Procedures', () => {
  let clinicA;
  let clinicB;
  let patientA;
  let dentistA;

  beforeEach(async () => {
    clinicA = await registerAndLogin('dental-clinic-a', 'admin-a@test.com');
    clinicB = await registerAndLogin('dental-clinic-b', 'admin-b@test.com');

    patientA = await createPatient(clinicA.token, { name: 'Alice Smith' });
    dentistA = await createDentist(clinicA);
  });

  describe('1. Money Utility & Minor Unit Financial Calculations', () => {
    it('accurately parses decimal dollar strings and floats without IEEE 754 precision loss', () => {
      // 0.1 + 0.2 in float is 0.30000000000000004
      const c1 = toCents('0.10');
      const c2 = toCents('0.20');
      const sum = addCents(c1, c2);

      expect(c1).toBe(10);
      expect(c2).toBe(20);
      expect(sum).toBe(30);
      expect(centsToDecimalString(sum)).toBe('0.30');

      // 19.99 * 100 in float is 1998.9999999999998
      expect(toCents('19.99')).toBe(1999);
      expect(centsToDecimalString(1999)).toBe('19.99');
    });

    it('performs exact addition and subtraction on minor units', () => {
      const total = addCents(15000, 7550, 32499);
      expect(total).toBe(55049);

      const balance = subtractCents(total, 20000);
      expect(balance).toBe(35049);
    });
  });

  describe('2. Dental Chart — Append-Only Behavior & Immutability', () => {
    it('creates an initial tooth record and sets supersedesId to null', async () => {
      const res = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 14,
          condition: 'caries',
          surfaces: ['O', 'M'],
          notes: 'Initial occlusal caries detected',
          visitDate: new Date('2026-01-10T10:00:00Z').toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.toothNumber).toBe(14);
      expect(res.body.data.condition).toBe('caries');
      expect(res.body.data.surfaces).toEqual(['O', 'M']);
      expect(res.body.data.supersedesId).toBeNull();
    });

    it('appends a replacement record with supersedesId referencing the previous entry without mutating it', async () => {
      // 1. Initial entry
      const initialRes = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 14,
          condition: 'caries',
          surfaces: ['O'],
          notes: 'Cavity on occlusal surface',
          visitDate: new Date('2026-01-10T10:00:00Z').toISOString(),
        });
      const initialId = initialRes.body.data.id;

      // 2. Replacement entry (filling completed)
      const updatedRes = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 14,
          condition: 'filled',
          surfaces: ['O'],
          notes: 'Composite resin filling placed',
          visitDate: new Date('2026-01-20T10:00:00Z').toISOString(),
          supersedesId: initialId,
        });

      expect(updatedRes.status).toBe(201);
      expect(updatedRes.body.data.supersedesId).toBe(initialId);
      expect(updatedRes.body.data.condition).toBe('filled');

      // 3. Verification: Historical initial record must still exist completely unmutated
      const rawInitial = await DentalChart.findById(initialId).lean();
      expect(rawInitial).not.toBeNull();
      expect(rawInitial.condition).toBe('caries');
      expect(rawInitial.notes).toBe('Cavity on occlusal surface');
      expect(rawInitial.supersedesId).toBeNull();
    });

    it('blocks direct in-place mutation attempts on DentalChart models to enforce append-only architecture', async () => {
      const { runWithTenant } = require('../src/multitenancy/tenantContext');
      let entry;
      await runWithTenant(clinicA.clinicId, async () => {
        entry = await DentalChart.create({
          clinicId: clinicA.clinicId,
          patientId: patientA.id,
          toothNumber: 14,
          condition: 'caries',
          surfaces: ['O'],
          updatedBy: clinicA.userId,
          visitDate: new Date(),
        });
      });

      await expect(
        DentalChart.updateOne({ _id: entry._id }, { $set: { condition: 'filled' } })
      ).rejects.toThrow(/append-only and immutable/);
    });
  });

  describe('3. Dental Chart — Supersedes Chain & Audit Trail', () => {
    it('maintains a contiguous multi-step supersedes chain for a tooth', async () => {
      // Step 1: Healthy
      const step1 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 3,
          condition: 'healthy',
          visitDate: new Date('2026-01-01T09:00:00Z').toISOString(),
        });
      const id1 = step1.body.data.id;

      // Step 2: Caries detected (auto-links to step 1)
      const step2 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 3,
          condition: 'caries',
          surfaces: ['O', 'D'],
          visitDate: new Date('2026-02-01T09:00:00Z').toISOString(),
        });
      const id2 = step2.body.data.id;
      expect(step2.body.data.supersedesId).toBe(id1);

      // Step 3: Filled
      const step3 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 3,
          condition: 'filled',
          surfaces: ['O', 'D'],
          visitDate: new Date('2026-03-01T09:00:00Z').toISOString(),
        });
      const id3 = step3.body.data.id;
      expect(step3.body.data.supersedesId).toBe(id2);

      // Step 4: Crown
      const step4 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 3,
          condition: 'crown',
          visitDate: new Date('2026-04-01T09:00:00Z').toISOString(),
        });
      expect(step4.body.data.supersedesId).toBe(id3);

      // Verify tooth history route returns all 4 records in order
      const historyRes = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/tooth/3/history`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.length).toBe(4);
      expect(historyRes.body.data[0].condition).toBe('healthy');
      expect(historyRes.body.data[1].condition).toBe('caries');
      expect(historyRes.body.data[2].condition).toBe('filled');
      expect(historyRes.body.data[3].condition).toBe('crown');
    });
  });

  describe('4. Historical Reconstruction — getDentalChartStateAsOf(date)', () => {
    it('reconstructs the exact state of patient dental chart at arbitrary historical dates', async () => {
      // Tooth 14: Caries on Jan 10
      await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 14,
          condition: 'caries',
          surfaces: ['O'],
          visitDate: new Date('2026-01-10T10:00:00Z').toISOString(),
        });

      // Tooth 14: Filled on Jan 20 (supersedes caries)
      await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 14,
          condition: 'filled',
          surfaces: ['O'],
          visitDate: new Date('2026-01-20T10:00:00Z').toISOString(),
        });

      // Tooth 19: Root canal on Feb 15
      await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          toothNumber: 19,
          condition: 'root_canal',
          visitDate: new Date('2026-02-15T10:00:00Z').toISOString(),
        });

      // 1. As of Jan 5 (before any records)
      const resJan5 = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/as-of?date=2026-01-05T00:00:00Z`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(resJan5.status).toBe(200);
      expect(resJan5.body.data.activeEntriesCount).toBe(0);

      // 2. As of Jan 15 (tooth 14 was caries, tooth 19 did not exist yet)
      const resJan15 = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/as-of?date=2026-01-15T00:00:00Z`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(resJan15.status).toBe(200);
      expect(resJan15.body.data.activeEntriesCount).toBe(1);
      expect(resJan15.body.data.teeth['14'].condition).toBe('caries');
      expect(resJan15.body.data.teeth['19']).toBeUndefined();

      // 3. As of Jan 25 (tooth 14 was filled, tooth 19 still did not exist)
      const resJan25 = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/as-of?date=2026-01-25T00:00:00Z`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(resJan25.status).toBe(200);
      expect(resJan25.body.data.activeEntriesCount).toBe(1);
      expect(resJan25.body.data.teeth['14'].condition).toBe('filled');
      expect(resJan25.body.data.teeth['19']).toBeUndefined();

      // 4. As of Mar 1 (tooth 14 is filled, tooth 19 is root_canal)
      const resMar1 = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/as-of?date=2026-03-01T00:00:00Z`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(resMar1.status).toBe(200);
      expect(resMar1.body.data.activeEntriesCount).toBe(2);
      expect(resMar1.body.data.teeth['14'].condition).toBe('filled');
      expect(resMar1.body.data.teeth['19'].condition).toBe('root_canal');
    });
  });

  describe('5. Treatment Plans — Creation, Pricing, Totals & Completion Tracking', () => {
    it('creates treatment plan with procedures and accurately computes minor unit totals', async () => {
      const res = await request(app)
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          title: 'Full Quadrant Rehabilitation',
          notes: 'Requires endodontic and restorative care',
          procedures: [
            {
              toothNumber: 14,
              description: 'Root Canal Treatment',
              price: 85000, // $850.00 in cents
            },
            {
              toothNumber: 14,
              description: 'Core Buildup',
              price: 25000, // $250.00 in cents
            },
            {
              toothNumber: 14,
              description: 'Porcelain Crown',
              price: 110000, // $1100.00 in cents
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Full Quadrant Rehabilitation');
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.procedures.length).toBe(3);

      // Financials: 85000 + 25000 + 110000 = 220000 cents ($2,200.00)
      expect(res.body.data.financials.estimatedTotal).toBe(220000);
      expect(res.body.data.financials.paidTotal).toBe(0);
      expect(res.body.data.financials.remainingBalance).toBe(220000);

      // Completion stats
      expect(res.body.data.completion.totalProcedures).toBe(3);
      expect(res.body.data.completion.completedProcedures).toBe(0);
      expect(res.body.data.completion.remainingProceduresCount).toBe(3);
      expect(res.body.data.completion.progressPercentage).toBe(0);
      expect(res.body.data.completion.isFullyCompleted).toBe(false);
    });

    it('tracks procedure progress and completion lifecycle', async () => {
      // 1. Create plan
      const createRes = await request(app)
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          title: 'Two Tooth Restoration',
          procedures: [
            { toothNumber: 4, description: 'Composite Filling', price: 15000 },
            { toothNumber: 5, description: 'Composite Filling', price: 15000 },
          ],
        });
      const planId = createRes.body.data.id;
      const proc1Id = createRes.body.data.procedures[0].id;
      const proc2Id = createRes.body.data.procedures[1].id;

      // 2. Advance plan status: draft -> presented -> accepted -> in_progress
      await request(app)
        .patch(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'presented' });

      await request(app)
        .patch(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'accepted' });

      await request(app)
        .patch(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'in_progress' });

      // 3. Complete procedure 1
      const comp1 = await request(app)
        .post(`/api/v1/treatment-plans/${planId}/procedures/${proc1Id}/complete`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(comp1.status).toBe(200);

      // Check plan progress
      const midPlan = await request(app)
        .get(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(midPlan.body.data.completion.completedProcedures).toBe(1);
      expect(midPlan.body.data.completion.remainingProceduresCount).toBe(1);
      expect(midPlan.body.data.completion.progressPercentage).toBe(50);
      expect(midPlan.body.data.completion.isFullyCompleted).toBe(false);

      // Attempting to complete the plan prematurely fails
      const earlyComplete = await request(app)
        .patch(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'completed' });
      expect(earlyComplete.status).toBe(400);

      // 4. Complete procedure 2
      await request(app)
        .post(`/api/v1/treatment-plans/${planId}/procedures/${proc2Id}/complete`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      // Now all procedures completed
      const fullPlan = await request(app)
        .get(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(fullPlan.body.data.completion.completedProcedures).toBe(2);
      expect(fullPlan.body.data.completion.remainingProceduresCount).toBe(0);
      expect(fullPlan.body.data.completion.progressPercentage).toBe(100);
      expect(fullPlan.body.data.completion.isFullyCompleted).toBe(true);

      // Final plan completion succeeds
      const finalComplete = await request(app)
        .patch(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'completed' });
      expect(finalComplete.status).toBe(200);
      expect(finalComplete.body.data.status).toBe('completed');
    });
  });

  describe('6. Payments & Remaining Balance Calculation', () => {
    it('records payments with idempotency protection and accurately reduces remaining balance', async () => {
      // 1. Create plan for $300.00 (30000 cents)
      const planRes = await request(app)
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          title: 'Periodontal Scaling',
          procedures: [
            { description: 'Deep Cleaning Quad 1', price: 15000 },
            { description: 'Deep Cleaning Quad 2', price: 15000 },
          ],
        });
      const planId = planRes.body.data.id;
      expect(planRes.body.data.financials.remainingBalance).toBe(30000);

      // 2. Partial Payment #1: $100.00 (10000 cents)
      const pay1 = await request(app)
        .post(`/api/v1/treatment-plans/${planId}/payments`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .set('Idempotency-Key', 'pay-unique-001')
        .send({
          amount: 10000,
          method: 'credit_card',
          reference: 'CHRG-1001',
        });
      expect(pay1.status).toBe(201);
      expect(pay1.body.remainingBalance).toBe(20000);
      expect(pay1.body.isDuplicate).toBe(false);

      // 3. Replay exact same payment with Idempotency-Key -> returns duplicate, balance unchanged
      const pay1Replay = await request(app)
        .post(`/api/v1/treatment-plans/${planId}/payments`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .set('Idempotency-Key', 'pay-unique-001')
        .send({
          amount: 10000,
          method: 'credit_card',
          reference: 'CHRG-1001',
        });
      expect(pay1Replay.status).toBe(200);
      expect(pay1Replay.body.isDuplicate).toBe(true);
      expect(pay1Replay.body.remainingBalance).toBe(20000);

      // 4. Payment #2: Remaining $200.00 (20000 cents)
      const pay2 = await request(app)
        .post(`/api/v1/treatment-plans/${planId}/payments`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .set('Idempotency-Key', 'pay-unique-002')
        .send({
          amount: 20000,
          method: 'cash',
        });
      expect(pay2.status).toBe(201);
      expect(pay2.body.remainingBalance).toBe(0);

      // 5. Verify treatment plan financials
      const finalPlan = await request(app)
        .get(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      expect(finalPlan.body.data.financials.estimatedTotal).toBe(30000);
      expect(finalPlan.body.data.financials.paidTotal).toBe(30000);
      expect(finalPlan.body.data.financials.remainingBalance).toBe(0);
    });

    it('rejects payments without Idempotency-Key header', async () => {
      const planRes = await request(app)
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          title: 'Consultation',
          procedures: [{ description: 'Exam', price: 5000 }],
        });

      const res = await request(app)
        .post(`/api/v1/treatment-plans/${planRes.body.data.id}/payments`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ amount: 5000 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });
  });

  describe('7. Edge Cases & Multi-Tenant Isolation', () => {
    it('enforces strict multi-tenant isolation across dental chart records', async () => {
      // Clinic A records condition on tooth 14
      await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ toothNumber: 14, condition: 'caries' });

      // Clinic B attempts to view patient A's chart -> 404
      const resChart = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicB.token}`);
      expect(resChart.status).toBe(404);

      // Clinic B attempts to view history of tooth 14 -> 404
      const resHist = await request(app)
        .get(`/api/v1/dental/chart/${patientA.id}/tooth/14/history`)
        .set('Authorization', `Bearer ${clinicB.token}`);
      expect(resHist.status).toBe(404);

      // Clinic B attempts to add chart entry to patient A -> 404
      const resMut = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicB.token}`)
        .send({ toothNumber: 14, condition: 'filled' });
      expect(resMut.status).toBe(404);
    });

    it('enforces strict multi-tenant isolation across treatment plans and payments', async () => {
      // Clinic A creates treatment plan
      const planRes = await request(app)
        .post('/api/v1/treatment-plans')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          patientId: patientA.id,
          dentistId: dentistA.id,
          title: 'Secret Plan',
          procedures: [{ description: 'Surgery', price: 100000 }],
        });
      const planId = planRes.body.data.id;

      // Clinic B attempts to view plan -> 404
      const getRes = await request(app)
        .get(`/api/v1/treatment-plans/${planId}`)
        .set('Authorization', `Bearer ${clinicB.token}`);
      expect(getRes.status).toBe(404);

      // Clinic B attempts to record payment on Clinic A plan -> 404
      const payRes = await request(app)
        .post(`/api/v1/treatment-plans/${planId}/payments`)
        .set('Authorization', `Bearer ${clinicB.token}`)
        .set('Idempotency-Key', 'cross-tenant-key')
        .send({ amount: 10000 });
      expect(payRes.status).toBe(404);
    });

    it('rejects invalid tooth numbers outside standard 1-32 Universal Numbering System', async () => {
      // Tooth 0
      const res0 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ toothNumber: 0, condition: 'caries' });
      expect(res0.status).toBe(400);

      // Tooth 33
      const res33 = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ toothNumber: 33, condition: 'caries' });
      expect(res33.status).toBe(400);
    });

    it('rejects invalid surfaces and conditions', async () => {
      const resInvalidSurface = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ toothNumber: 14, condition: 'caries', surfaces: ['Z'] });
      expect(resInvalidSurface.status).toBe(400);

      const resInvalidCondition = await request(app)
        .post(`/api/v1/dental/chart/${patientA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ toothNumber: 14, condition: 'alien_infection' });
      expect(resInvalidCondition.status).toBe(400);
    });

    it('returns empty teeth map for patient with no dental chart records', async () => {
      const newPatient = await createPatient(clinicA.token, { name: 'Brand New' });
      const res = await request(app)
        .get(`/api/v1/dental/chart/${newPatient.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.activeEntriesCount).toBe(0);
      expect(res.body.data.entries).toEqual([]);
      expect(res.body.data.teeth).toEqual({});
    });
  });
});
