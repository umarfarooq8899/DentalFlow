'use strict';

const request = require('supertest');
const app = require('../src/app');
const Invoice = require('../src/models/Invoice');
const Payment = require('../src/models/Payment');

async function registerAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'Billing',
    lastName: 'Admin',
  });
  const response = await request(app).post('/api/v1/auth/login').send({
    email,
    clinicSlug,
    password: 'Password123!',
  });
  return {
    token: response.body.data.accessToken,
    userId: response.body.data.user.id,
    clinicId: response.body.data.clinic.id,
  };
}

async function createPatient(token) {
  const response = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Billing Patient' });
  return response.body.data;
}

async function createDentist(auth) {
  const response = await request(app)
    .post('/api/v1/dentists')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ userId: auth.userId, specialty: 'General Dentistry', licenseInfo: 'BILL-123' });
  return response.body.data;
}

async function createInvoice(auth, patientId, amount, key, extra = {}) {
  return request(app)
    .post('/api/v1/invoices')
    .set('Authorization', `Bearer ${auth.token}`)
    .set('Idempotency-Key', key)
    .send({
      patientId,
      items: [{ type: 'procedure', description: 'Dental service', quantity: 1, unitAmount: amount }],
      ...extra,
    });
}

async function issueInvoice(auth, invoiceId) {
  return request(app)
    .patch(`/api/v1/invoices/${invoiceId}/status`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ status: 'issued' });
}

async function payInvoice(auth, invoiceId, amount, key, extra = {}) {
  return request(app)
    .post('/api/v1/payments')
    .set('Authorization', `Bearer ${auth.token}`)
    .set('Idempotency-Key', key)
    .send({ amount, allocations: [{ invoiceId, amount }], ...extra });
}

describe('TASK 6 — Billing, Invoices, Payments & Financial Integrity', () => {
  let clinicA;
  let clinicB;
  let patientA;
  let dentistA;

  beforeEach(async () => {
    clinicA = await registerAndLogin('billing-clinic-a', 'billing-a@test.com');
    clinicB = await registerAndLogin('billing-clinic-b', 'billing-b@test.com');
    patientA = await createPatient(clinicA.token);
    dentistA = await createDentist(clinicA);
  });

  it('calculates invoice line totals, discounts, taxes, and outstanding balance in cents', async () => {
    const response = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'invoice-total-001')
      .send({
        patientId: patientA.id,
        items: [
          { type: 'procedure', description: 'Filling', quantity: 2, unitAmount: 1250 },
          { type: 'fee', description: 'Exam', quantity: 1, unitAmount: 500 },
        ],
        discountAmount: 300,
        taxAmount: 175,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.subtotal).toBe(3000);
    expect(response.body.data.discountAmount).toBe(300);
    expect(response.body.data.taxAmount).toBe(175);
    expect(response.body.data.total).toBe(2875);
    expect(response.body.data.outstandingBalance).toBe(2875);

    const fetched = await request(app)
      .get(`/api/v1/invoices/${response.body.data.id}`)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.total).toBe(2875);

    const listed = await request(app)
      .get('/api/v1/invoices?patientId=' + patientA.id)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
  });

  it('generates an idempotent invoice from treatment-plan procedures', async () => {
    const planResponse = await request(app)
      .post('/api/v1/treatment-plans')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({
        patientId: patientA.id,
        dentistId: dentistA.id,
        title: 'Restorative plan',
        procedures: [
          { description: 'Molar restoration', price: 7500 },
          { description: 'Polishing', price: 2500 },
        ],
      });
    const planId = planResponse.body.data.id;

    const create = () => request(app)
      .post(`/api/v1/invoices/from-treatment-plan/${planId}`)
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'invoice-from-plan-001')
      .send({ discountAmount: 500, taxAmount: 100 });
    const first = await create();
    const replay = await create();

    expect(first.status).toBe(201);
    expect(first.body.data.subtotal).toBe(10000);
    expect(first.body.data.total).toBe(9600);
    expect(replay.status).toBe(200);
    expect(replay.body.isDuplicate).toBe(true);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await Invoice.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
  });

  it('enforces invoice transitions and derives paid status and balance from payments', async () => {
    const created = await createInvoice(clinicA, patientA.id, 10000, 'invoice-status-001');
    const invoiceId = created.body.data.id;

    const invalidEarlyPaid = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({ status: 'paid' });
    expect(invalidEarlyPaid.status).toBe(400);

    expect((await issueInvoice(clinicA, invoiceId)).status).toBe(200);
    expect((await payInvoice(clinicA, invoiceId, 4000, 'invoice-status-pay-1')).status).toBe(201);

    const partial = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(partial.body.data.status).toBe('partially_paid');
    expect(partial.body.data.paidTotal).toBe(4000);
    expect(partial.body.data.outstandingBalance).toBe(6000);

    expect((await payInvoice(clinicA, invoiceId, 6000, 'invoice-status-pay-2')).status).toBe(201);
    const paid = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.outstandingBalance).toBe(0);

    const cannotVoidPaid = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}/status`)
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({ status: 'voided' });
    expect(cannotVoidPaid.status).toBe(400);
  });

  it('allocates one payment across multiple invoices and exposes payment history', async () => {
    const invoiceA = await createInvoice(clinicA, patientA.id, 2000, 'alloc-invoice-001');
    const invoiceB = await createInvoice(clinicA, patientA.id, 3000, 'alloc-invoice-002');
    await issueInvoice(clinicA, invoiceA.body.data.id);
    await issueInvoice(clinicA, invoiceB.body.data.id);

    const payment = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'allocation-payment-001')
      .send({
        amount: 2500,
        allocations: [
          { invoiceId: invoiceA.body.data.id, amount: 2000 },
          { invoiceId: invoiceB.body.data.id, amount: 500 },
        ],
        method: 'credit_card',
      });
    expect(payment.status).toBe(201);
    expect(payment.body.data.allocations).toHaveLength(2);

    const viewA = await request(app).get(`/api/v1/invoices/${invoiceA.body.data.id}`).set('Authorization', `Bearer ${clinicA.token}`);
    const viewB = await request(app).get(`/api/v1/invoices/${invoiceB.body.data.id}`).set('Authorization', `Bearer ${clinicA.token}`);
    expect(viewA.body.data.status).toBe('paid');
    expect(viewA.body.data.outstandingBalance).toBe(0);
    expect(viewB.body.data.outstandingBalance).toBe(2500);

    const history = await request(app)
      .get(`/api/v1/invoices/${invoiceB.body.data.id}/payments`)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0].amount).toBe(2500);
  });

  it('replays duplicate payment requests but rejects reusing a key with different data', async () => {
    const invoice = await createInvoice(clinicA, patientA.id, 5000, 'duplicate-invoice-001');
    await issueInvoice(clinicA, invoice.body.data.id);

    const first = await payInvoice(clinicA, invoice.body.data.id, 2000, 'duplicate-payment-001');
    const replay = await payInvoice(clinicA, invoice.body.data.id, 2000, 'duplicate-payment-001');
    const mismatch = await payInvoice(clinicA, invoice.body.data.id, 1000, 'duplicate-payment-001');

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.isDuplicate).toBe(true);
    expect(mismatch.status).toBe(409);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
  });

  it('handles concurrent duplicate invoice and payment requests exactly once', async () => {
    const create = () => createInvoice(clinicA, patientA.id, 6000, 'concurrent-invoice-001');
    const [invoiceOne, invoiceTwo] = await Promise.all([create(), create()]);
    expect([invoiceOne.status, invoiceTwo.status].sort()).toEqual([200, 201]);
    expect(await Invoice.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);

    const invoiceId = invoiceOne.body.data.id;
    await issueInvoice(clinicA, invoiceId);
    const pay = () => payInvoice(clinicA, invoiceId, 6000, 'concurrent-payment-001');
    const paymentResponses = await Promise.all([pay(), pay()]);
    expect(paymentResponses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);

    const invoice = await request(app).get(`/api/v1/invoices/${invoiceId}`).set('Authorization', `Bearer ${clinicA.token}`);
    expect(invoice.body.data.paidTotal).toBe(6000);
    expect(invoice.body.data.status).toBe('paid');
  });

  it('allows distinct idempotency keys for distinct payments', async () => {
    const invoice = await createInvoice(clinicA, patientA.id, 5000, 'different-keys-invoice-001');
    await issueInvoice(clinicA, invoice.body.data.id);
    const first = await payInvoice(clinicA, invoice.body.data.id, 2000, 'different-payment-key-1');
    const second = await payInvoice(clinicA, invoice.body.data.id, 3000, 'different-payment-key-2');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(2);
  });

  it('does not persist failed payments, allowing a valid retry with the same key', async () => {
    const invoice = await createInvoice(clinicA, patientA.id, 5000, 'retry-invoice-001');
    await issueInvoice(clinicA, invoice.body.data.id);
    const failed = await payInvoice(clinicA, invoice.body.data.id, 6000, 'retry-payment-001');
    expect(failed.status).toBe(400);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(0);

    const retry = await payInvoice(clinicA, invoice.body.data.id, 5000, 'retry-payment-001');
    expect(retry.status).toBe(201);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
  });

  it('rejects invalid allocations, overpayments, and client-controlled payment status', async () => {
    const invoice = await createInvoice(clinicA, patientA.id, 4000, 'invalid-payment-invoice-001');
    await issueInvoice(clinicA, invoice.body.data.id);
    const mismatched = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'invalid-payment-total-001')
      .send({ amount: 1000, allocations: [{ invoiceId: invoice.body.data.id, amount: 900 }] });
    expect(mismatched.status).toBe(400);

    const overpayment = await payInvoice(clinicA, invoice.body.data.id, 5000, 'invalid-overpayment-001');
    expect(overpayment.status).toBe(400);

    const clientStatus = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'invalid-payment-status-001')
      .send({
        amount: 1000,
        allocations: [{ invoiceId: invoice.body.data.id, amount: 1000 }],
        status: 'voided',
      });
    expect(clientStatus.status).toBe(400);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(0);
  });

  it('prevents cross-tenant invoice retrieval and payment allocation', async () => {
    const invoice = await createInvoice(clinicA, patientA.id, 5000, 'tenant-invoice-001');
    await issueInvoice(clinicA, invoice.body.data.id);

    const get = await request(app)
      .get(`/api/v1/invoices/${invoice.body.data.id}`)
      .set('Authorization', `Bearer ${clinicB.token}`);
    expect(get.status).toBe(404);

    const payment = await payInvoice(clinicB, invoice.body.data.id, 5000, 'tenant-payment-001');
    expect(payment.status).toBe(404);
    expect(await Payment.countDocuments({ clinicId: clinicA.clinicId })).toBe(0);
  });
});