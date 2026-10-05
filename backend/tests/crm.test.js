'use strict';

const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Patient = require('../src/models/Patient');

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'CRM',
    lastName: 'Admin',
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

async function createLead(auth, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/leads')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ name: 'Test Lead', source: 'website', ...overrides });
  return res.body.data;
}

async function createConversation(auth, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/conversations')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ channel: 'email', ...overrides });
  return res.body.data;
}

// ─── LEADS ────────────────────────────────────────────────────────────────────

describe('TASK 8 — CRM: Leads', () => {
  let clinicA;
  let clinicB;

  beforeEach(async () => {
    clinicA = await registerAndLogin('crm-leads-a', 'leads-a@test.com');
    clinicB = await registerAndLogin('crm-leads-b', 'leads-b@test.com');
  });

  // ── Capture ──────────────────────────────────────────────────────────────────

  describe('POST /api/v1/leads', () => {
    it('captures a lead and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ name: 'Alice Smith', phone: '555-1234', source: 'website' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Alice Smith');
      expect(res.body.data.status).toBe('new');
      expect(res.body.data.source).toBe('website');
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].action).toBe('created');
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ source: 'phone' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app)
        .post('/api/v1/leads')
        .send({ name: 'NoAuth Lead' });

      expect(res.status).toBe(401);
    });
  });

  // ── Search / List ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/leads', () => {
    beforeEach(async () => {
      await createLead(clinicA, { name: 'Alice Search', email: 'alice@test.com', source: 'phone' });
      await createLead(clinicA, { name: 'Bob Browser', phone: '555-0001', source: 'website' });
      await createLead(clinicA, { name: 'Carol Contact', source: 'referral' });
    });

    it('lists all leads for the clinic', async () => {
      const res = await request(app)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.pagination.total).toBe(3);
    });

    it('filters by status', async () => {
      const lead = await createLead(clinicA, { name: 'Lost Lead' });
      // Move to contacted first (valid transition from new)
      await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'contacted' });
      // Then to lost
      await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'lost' });

      const res = await request(app)
        .get('/api/v1/leads?status=lost')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Lost Lead');
    });

    it('searches by name', async () => {
      const res = await request(app)
        .get('/api/v1/leads?search=alice')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Alice Search');
    });

    it('searches by email', async () => {
      const res = await request(app)
        .get('/api/v1/leads?search=alice@test.com')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('supports pagination', async () => {
      const res = await request(app)
        .get('/api/v1/leads?limit=2&page=1')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBe(3);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it('filters by source', async () => {
      const res = await request(app)
        .get('/api/v1/leads?source=referral')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Carol Contact');
    });

    // ── Tenant Isolation ───────────────────────────────────────────────────────

    it('does not return leads from another clinic', async () => {
      await createLead(clinicB, { name: 'Other Clinic Lead' });

      const res = await request(app)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every((l) => l.name !== 'Other Clinic Lead')).toBe(true);
    });
  });

  // ── Get Single Lead ───────────────────────────────────────────────────────────

  describe('GET /api/v1/leads/:id', () => {
    it('returns a lead by ID', async () => {
      const lead = await createLead(clinicA, { name: 'Single Lead' });

      const res = await request(app)
        .get(`/api/v1/leads/${lead.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(lead.id);
    });

    it('returns 404 for a lead from another clinic', async () => {
      const leadB = await createLead(clinicB, { name: 'Clinic B Lead' });

      const res = await request(app)
        .get(`/api/v1/leads/${leadB.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ── Assignment ────────────────────────────────────────────────────────────────

  describe('PATCH /api/v1/leads/:id/assign', () => {
    it('assigns a lead to a staff user', async () => {
      const lead = await createLead(clinicA, { name: 'Assign Me' });

      const res = await request(app)
        .patch(`/api/v1/leads/${lead.id}/assign`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ assignedTo: clinicA.userId });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedTo).toBeTruthy();
      const lastHistory = res.body.data.history.at(-1);
      expect(lastHistory.action).toBe('assigned');
    });

    it('unassigns a lead by sending null', async () => {
      const lead = await createLead(clinicA, { name: 'Unassign Me' });
      await request(app)
        .patch(`/api/v1/leads/${lead.id}/assign`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ assignedTo: clinicA.userId });

      const res = await request(app)
        .patch(`/api/v1/leads/${lead.id}/assign`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ assignedTo: null });

      expect(res.status).toBe(200);
      expect(res.body.data.assignedTo).toBeNull();
    });
  });

  // ── Status Tracking ───────────────────────────────────────────────────────────

  describe('PATCH /api/v1/leads/:id/status', () => {
    it('transitions from new → contacted', async () => {
      const lead = await createLead(clinicA, { name: 'Status Lead' });

      const res = await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'contacted', note: 'Called the client' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('contacted');
      const lastHistory = res.body.data.history.at(-1);
      expect(lastHistory.action).toBe('status_changed');
      expect(lastHistory.fromStatus).toBe('new');
      expect(lastHistory.toStatus).toBe('contacted');
      expect(lastHistory.note).toBe('Called the client');
    });

    it('rejects an invalid status transition (new → converted)', async () => {
      const lead = await createLead(clinicA, { name: 'Bad Transition Lead' });

      const res = await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'converted' });

      // converted is not a valid manual status — it's set via /convert
      expect(res.status).toBe(400);
    });

    it('rejects setting status on a converted lead', async () => {
      const lead = await createLead(clinicA, { name: 'Pre-Converted Lead' });
      await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      const res = await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'contacted' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LEAD_ALREADY_CONVERTED');
    });
  });

  // ── Conversion ─────────────────────────────────────────────────────────────

  describe('POST /api/v1/leads/:id/convert', () => {
    it('converts a lead to a new patient', async () => {
      const lead = await createLead(clinicA, {
        name: 'Convert Me',
        phone: '555-0042',
        email: 'convert@test.com',
      });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lead.status).toBe('converted');
      expect(res.body.data.lead.patientId).toBeTruthy();
      expect(res.body.data.patient.name).toBe('Convert Me');
      expect(res.body.data.patient.patientNo).toMatch(/^PT-\d{5}$/);

      const historyEntry = res.body.data.lead.history.at(-1);
      expect(historyEntry.action).toBe('converted');
    });

    it('links to an existing patient', async () => {
      const patientRes = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ name: 'Existing Patient', phone: '555-1111' });
      const patientId = patientRes.body.data.id;

      const lead = await createLead(clinicA, { name: 'Link Lead' });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ existingPatientId: patientId });

      expect(res.status).toBe(200);
      expect(res.body.data.patient.id).toBe(patientId);
      expect(res.body.data.lead.patientId).toBe(patientId);
    });

    it('prevents duplicate conversion', async () => {
      const lead = await createLead(clinicA, { name: 'Already Converted' });

      await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LEAD_ALREADY_CONVERTED');
    });

    it('prevents conversion using a patient from another clinic', async () => {
      const patientResB = await request(app)
        .post('/api/v1/patients')
        .set('Authorization', `Bearer ${clinicB.token}`)
        .send({ name: 'Clinic B Patient' });
      const patientBId = patientResB.body.data.id;

      const lead = await createLead(clinicA, { name: 'Cross Tenant Lead' });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ existingPatientId: patientBId });

      expect(res.status).toBe(404);
    });

    it('preserves full lead history after conversion', async () => {
      const lead = await createLead(clinicA, { name: 'History Lead' });
      await request(app)
        .patch(`/api/v1/leads/${lead.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'contacted' });
      await request(app)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ note: 'Interested in whitening' });

      await request(app)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      const res = await request(app)
        .get(`/api/v1/leads/${lead.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      const history = res.body.data.history;
      // created + status_changed + note_added + converted
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history.map((h) => h.action)).toContain('created');
      expect(history.map((h) => h.action)).toContain('status_changed');
      expect(history.map((h) => h.action)).toContain('note_added');
      expect(history.map((h) => h.action)).toContain('converted');
    });
  });

  // ── Notes ──────────────────────────────────────────────────────────────────

  describe('POST /api/v1/leads/:id/notes', () => {
    it('adds a note to a lead', async () => {
      const lead = await createLead(clinicA, { name: 'Note Lead' });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ note: 'Interested in Invisalign' });

      expect(res.status).toBe(201);
      const lastHistory = res.body.data.history.at(-1);
      expect(lastHistory.action).toBe('note_added');
      expect(lastHistory.note).toBe('Interested in Invisalign');
    });

    it('returns 400 when note is empty', async () => {
      const lead = await createLead(clinicA, { name: 'Note Lead 2' });

      const res = await request(app)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ note: '' });

      expect(res.status).toBe(400);
    });
  });
});

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────

describe('TASK 8 — CRM: Conversations', () => {
  let clinicA;
  let clinicB;
  let leadA;

  beforeEach(async () => {
    clinicA = await registerAndLogin('crm-conv-a', 'conv-a@test.com');
    clinicB = await registerAndLogin('crm-conv-b', 'conv-b@test.com');
    leadA = await createLead(clinicA, { name: 'Lead for Conv' });
  });

  describe('POST /api/v1/conversations', () => {
    it('creates a conversation and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ channel: 'email', subject: 'Initial inquiry', leadId: leadA.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.channel).toBe('email');
      expect(res.body.data.subject).toBe('Initial inquiry');
      expect(res.body.data.leadId).toBe(leadA.id);
      expect(res.body.data.status).toBe('open');
      // Creating user auto-added as participant
      expect(res.body.data.participants.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 for missing channel', async () => {
      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ subject: 'No channel' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when leadId belongs to another clinic', async () => {
      const leadB = await createLead(clinicB, { name: 'Clinic B Lead' });

      const res = await request(app)
        .post('/api/v1/conversations')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ channel: 'sms', leadId: leadB.id });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/conversations', () => {
    beforeEach(async () => {
      await createConversation(clinicA, { channel: 'email', leadId: leadA.id });
      await createConversation(clinicA, { channel: 'sms' });
      await createConversation(clinicA, { channel: 'whatsapp' });
    });

    it('lists all conversations for the clinic', async () => {
      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });

    it('filters by channel', async () => {
      const res = await request(app)
        .get('/api/v1/conversations?channel=sms')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].channel).toBe('sms');
    });

    it('filters by leadId', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations?leadId=${leadA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('does not return conversations from another clinic', async () => {
      await createConversation(clinicB, { channel: 'email' });

      const res = await request(app)
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3); // Only clinic A's
    });

    it('supports pagination', async () => {
      const res = await request(app)
        .get('/api/v1/conversations?limit=2&page=1')
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBe(3);
    });
  });

  describe('GET /api/v1/conversations/:id — tenant isolation', () => {
    it('returns 404 for a conversation from another clinic', async () => {
      const convB = await createConversation(clinicB, { channel: 'sms' });

      const res = await request(app)
        .get(`/api/v1/conversations/${convB.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/conversations/:id/status', () => {
    it('closes a conversation', async () => {
      const conv = await createConversation(clinicA, { channel: 'email' });

      const res = await request(app)
        .patch(`/api/v1/conversations/${conv.id}/status`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'closed' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('closed');
    });
  });

  describe('Participants', () => {
    it('adds a participant to a conversation', async () => {
      const conv = await createConversation(clinicA, { channel: 'email' });

      const res = await request(app)
        .post(`/api/v1/conversations/${conv.id}/participants`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ role: 'contact', displayName: 'Jane Prospect' });

      expect(res.status).toBe(200);
      const contact = res.body.data.participants.find((p) => p.role === 'contact');
      expect(contact).toBeDefined();
      expect(contact.displayName).toBe('Jane Prospect');
    });

    it('removes a participant from a conversation', async () => {
      const conv = await createConversation(clinicA, { channel: 'email' });
      // Add one
      const updatedConv = (
        await request(app)
          .post(`/api/v1/conversations/${conv.id}/participants`)
          .set('Authorization', `Bearer ${clinicA.token}`)
          .send({ role: 'contact', displayName: 'Remove Me' })
      ).body.data;

      const contact = updatedConv.participants.find((p) => p.role === 'contact');

      const res = await request(app)
        .delete(`/api/v1/conversations/${conv.id}/participants/${contact.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      const removedParticipant = res.body.data.participants.find((p) => p.id === contact.id);
      expect(removedParticipant.leftAt).toBeTruthy();
    });
  });
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

describe('TASK 8 — CRM: Messages', () => {
  let clinicA;
  let clinicB;
  let convA;
  let convB;

  beforeEach(async () => {
    clinicA = await registerAndLogin('crm-msg-a', 'msg-a@test.com');
    clinicB = await registerAndLogin('crm-msg-b', 'msg-b@test.com');
    convA = await createConversation(clinicA, { channel: 'email' });
    convB = await createConversation(clinicB, { channel: 'sms' });
  });

  async function postMessage(auth, conversationId, overrides = {}) {
    const res = await request(app)
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ body: 'Hello!', ...overrides });
    return res;
  }

  describe('POST /api/v1/conversations/:conversationId/messages', () => {
    it('creates a message and returns 201', async () => {
      const res = await postMessage(clinicA, convA.id, {
        body: 'Hello from clinic A',
        senderType: 'staff',
        channelMeta: { subject: 'First Contact' },
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.body).toBe('Hello from clinic A');
      expect(res.body.data.channel).toBe('email');
      expect(res.body.data.channelMeta.subject).toBe('First Contact');
      expect(res.body.data.deliveryStatus).toBe('pending');
    });

    it('returns 400 when body is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${convA.id}/messages`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when conversation belongs to another clinic', async () => {
      const res = await postMessage(clinicA, convB.id, { body: 'Cross tenant!' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/conversations/:conversationId/messages — pagination', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 15; i++) {
        await postMessage(clinicA, convA.id, { body: `Message ${i}` });
      }
    });

    it('returns paginated messages in ascending order', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages?limit=5&page=1`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.pagination.total).toBe(15);
      expect(res.body.pagination.totalPages).toBe(3);
    });

    it('returns page 2 correctly with unique messages', async () => {
      // Fetch all 3 pages of 5
      const page1 = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages?limit=5&page=1&sortOrder=asc`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      const page2 = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages?limit=5&page=2&sortOrder=asc`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      const page3 = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages?limit=5&page=3&sortOrder=asc`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      // Each page should have 5 results
      expect(page1.body.data).toHaveLength(5);
      expect(page2.body.data).toHaveLength(5);
      expect(page3.body.data).toHaveLength(5);

      // All 15 IDs across 3 pages must be unique
      const allIds = [
        ...page1.body.data.map((m) => m.id),
        ...page2.body.data.map((m) => m.id),
        ...page3.body.data.map((m) => m.id),
      ];
      expect(new Set(allIds).size).toBe(15);
    });

    it('returns cursor-based pagination fields', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages?limit=5`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.body.pagination.cursors).toBeDefined();
      expect(res.body.pagination.cursors.after).toBeTruthy();
    });

    it('returns 404 for messages of another clinic conversation', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${convB.id}/messages`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/v1/conversations/:conversationId/messages/:id/delivery', () => {
    it('updates delivery status to delivered', async () => {
      const msgRes = await postMessage(clinicA, convA.id, { body: 'Deliver me' });
      const msgId = msgRes.body.data.id;

      const res = await request(app)
        .patch(`/api/v1/conversations/${convA.id}/messages/${msgId}/delivery`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ status: 'delivered' });

      expect(res.status).toBe(200);
      expect(res.body.data.deliveryStatus).toBe('delivered');
      expect(res.body.data.deliveredAt).toBeTruthy();
    });
  });

  describe('DELETE /api/v1/conversations/:conversationId/messages/:id', () => {
    it('soft-deletes a message', async () => {
      const msgRes = await postMessage(clinicA, convA.id, { body: 'Delete me' });
      const msgId = msgRes.body.data.id;

      const res = await request(app)
        .delete(`/api/v1/conversations/${convA.id}/messages/${msgId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deletedAt).toBeTruthy();
    });

    it('excluded deleted messages from list', async () => {
      const msgRes = await postMessage(clinicA, convA.id, { body: 'Will be deleted' });
      await postMessage(clinicA, convA.id, { body: 'Will remain' });
      const msgId = msgRes.body.data.id;

      await request(app)
        .delete(`/api/v1/conversations/${convA.id}/messages/${msgId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      const listRes = await request(app)
        .get(`/api/v1/conversations/${convA.id}/messages`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(listRes.body.data.every((m) => m.id !== msgId)).toBe(true);
      expect(listRes.body.data).toHaveLength(1);
    });
  });

  // ── Conversation lastMessageAt update ─────────────────────────────────────

  describe('lastMessageAt tracking', () => {
    it('updates conversation lastMessageAt when a message is posted', async () => {
      const convRes = await request(app)
        .get(`/api/v1/conversations/${convA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);
      const before = convRes.body.data.lastMessageAt;

      await postMessage(clinicA, convA.id, { body: 'New message' });

      const afterRes = await request(app)
        .get(`/api/v1/conversations/${convA.id}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(afterRes.body.data.lastMessageAt).toBeTruthy();
      if (before) {
        expect(new Date(afterRes.body.data.lastMessageAt) >= new Date(before)).toBe(true);
      }
    });
  });
});

// ─── TENANT ISOLATION (Aggregate) ─────────────────────────────────────────────

describe('TASK 8 — Tenant Isolation: CRM', () => {
  let clinicA;
  let clinicB;

  beforeEach(async () => {
    clinicA = await registerAndLogin('crm-iso-a', 'iso-a@test.com');
    clinicB = await registerAndLogin('crm-iso-b', 'iso-b@test.com');
  });

  it('Clinic B cannot read Clinic A leads', async () => {
    await createLead(clinicA, { name: 'Clinic A Lead' });

    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${clinicB.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('Clinic B cannot access Clinic A conversation by ID', async () => {
    const conv = await createConversation(clinicA, { channel: 'sms' });

    const res = await request(app)
      .get(`/api/v1/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${clinicB.token}`);

    expect(res.status).toBe(404);
  });

  it('Clinic B cannot post a message to Clinic A conversation', async () => {
    const conv = await createConversation(clinicA, { channel: 'sms' });

    const res = await request(app)
      .post(`/api/v1/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${clinicB.token}`)
      .send({ body: 'Infiltrating!' });

    expect(res.status).toBe(404);
  });

  it('Clinic B cannot convert Clinic A lead', async () => {
    const lead = await createLead(clinicA, { name: 'Protected Lead' });

    const res = await request(app)
      .post(`/api/v1/leads/${lead.id}/convert`)
      .set('Authorization', `Bearer ${clinicB.token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe('TASK 8 — RBAC: CRM Endpoints', () => {
  it('returns 401 for unauthenticated lead list request', async () => {
    const res = await request(app).get('/api/v1/leads');
    expect(res.status).toBe(401);
  });

  it('returns 401 for unauthenticated conversation request', async () => {
    const res = await request(app).get('/api/v1/conversations');
    expect(res.status).toBe(401);
  });

  it('returns 401 for unauthenticated message post', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/000000000000000000000001/messages')
      .send({ body: 'No auth' });
    expect(res.status).toBe(401);
  });
});
