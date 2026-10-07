'use strict';

const request = require('supertest');
const app = require('../src/app');
const Lead = require('../src/models/Lead');
const Conversation = require('../src/models/Conversation');
const Message = require('../src/models/Message');
const AIJob = require('../src/models/AIJob');
const { PIIRedactor, rehydrate } = require('../src/integrations/ai/piiRedactor');
const { getActiveProvider } = require('../src/integrations/ai/providers');
const AIGateway = require('../src/integrations/ai/aiGateway');
const aiLogger = require('../src/integrations/ai/sanitizerLogger');

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function registerAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'AI',
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
    .send({ name: 'Arthur Dent', email: 'arthur@hitchhiker.io', phone: '03001234567', ...overrides });
  return res.body.data;
}

async function createConversation(auth, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/conversations')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ channel: 'email', ...overrides });
  return res.body.data;
}

async function postMessage(auth, conversationId, overrides = {}) {
  const res = await request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ body: 'Hello clinic!', ...overrides });
  return res.body.data;
}

describe('TASK 9 — AI Gateway, PII Redaction, Lead Scoring & Suggested Replies', () => {
  let clinicA;
  let clinicB;
  let provider;

  beforeEach(async () => {
    provider = getActiveProvider();
    provider.reset();
    clinicA = await registerAndLogin('ai-clinic-a', 'ai-a@test.com');
    clinicB = await registerAndLogin('ai-clinic-b', 'ai-b@test.com');
  });

  afterEach(() => {
    provider.reset();
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 1. PII REDACTION UNIT TESTS
  // ═════════════════════════════════════════════════════════════════════════════
  describe('PII Redactor Engine', () => {
    it('redacts patient/lead names correctly', () => {
      const redactor = new PIIRedactor();
      const input = 'Patient John Smith arrived for an appointment with Dr. Sarah Connor.';
      const res = redactor.redact(input, { names: ['John Smith', 'Sarah Connor'] });

      expect(res.redactedText).not.toContain('John Smith');
      expect(res.redactedText).not.toContain('Sarah Connor');
      expect(res.redactedText).toContain('[NAME_001]');
      expect(res.tokens['[NAME_001]']).toBe('John Smith');
      expect(res.piiStripped).toBe(true);
    });

    it('redacts phone numbers in various formats', () => {
      const redactor = new PIIRedactor();
      const input = 'Call 03001234567 or international +1-555-456-7890 if urgent.';
      const res = redactor.redact(input);

      expect(res.redactedText).not.toContain('03001234567');
      expect(res.redactedText).not.toContain('555-456-7890');
      expect(res.redactedText).toContain('[PHONE_001]');
      expect(res.piiStripped).toBe(true);
    });

    it('redacts email addresses', () => {
      const redactor = new PIIRedactor();
      const input = 'Send records to john.smith+dental@example.org immediately.';
      const res = redactor.redact(input);

      expect(res.redactedText).not.toContain('john.smith+dental@example.org');
      expect(res.redactedText).toContain('[EMAIL_001]');
      expect(res.tokens['[EMAIL_001]']).toBe('john.smith+dental@example.org');
    });

    it('redacts physical street addresses', () => {
      const redactor = new PIIRedactor();
      const input = 'Patient lives at 123 Main Street, Suite 400 and works at 742 Evergreen Terrace.';
      const res = redactor.redact(input);

      expect(res.redactedText).not.toContain('123 Main Street, Suite 400');
      expect(res.redactedText).toContain('[ADDRESS_001]');
      expect(res.piiStripped).toBe(true);
    });

    it('redacts multiple mixed PII values in a realistic patient intake note', () => {
      const redactor = new PIIRedactor();
      const text =
        'John Smith called from 03001234567. His email is john@hitchhiker.io and he resides at 42 Galaxy Way, London.';
      const res = redactor.redact(text, {
        names: ['John Smith'],
        phones: ['03001234567'],
        emails: ['john@hitchhiker.io'],
        addresses: ['42 Galaxy Way, London'],
      });

      expect(res.redactedText).not.toContain('John Smith');
      expect(res.redactedText).not.toContain('03001234567');
      expect(res.redactedText).not.toContain('john@hitchhiker.io');
      expect(res.redactedText).not.toContain('42 Galaxy Way, London');

      expect(res.redactedText).toMatch(/\[NAME_\d+\]/);
      expect(res.redactedText).toMatch(/\[PHONE_\d+\]/);
      expect(res.redactedText).toMatch(/\[EMAIL_\d+\]/);
      expect(res.redactedText).toMatch(/\[ADDRESS_\d+\]/);
      expect(res.count).toBe(4);
    });

    it('rehydrates structured output replacing tokens back with internal identities', () => {
      const tokens = {
        '[NAME_001]': 'Arthur Dent',
        '[PHONE_001]': '03001234567',
        '[EMAIL_001]': 'arthur@hitchhiker.io',
      };

      const template = {
        greeting: 'Hello [NAME_001], we sent confirmation to [EMAIL_001].',
        callAction: 'Staff will call [PHONE_001] shortly.',
      };

      const rehydrated = rehydrate(template, tokens);
      expect(rehydrated.greeting).toBe('Hello Arthur Dent, we sent confirmation to arthur@hitchhiker.io.');
      expect(rehydrated.callAction).toBe('Staff will call 03001234567 shortly.');
    });

    it('POST /api/v1/ai/redact previews and audits PII redaction without calling LLM', async () => {
      const res = await request(app)
        .post('/api/v1/ai/redact')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          text: 'Patient Arthur Dent called 03009998877 at 12 Baker Street.',
          knownEntities: { names: ['Arthur Dent'] },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.redactedText).not.toContain('Arthur Dent');
      expect(res.body.data.redactedText).not.toContain('03009998877');
      expect(res.body.data.piiStripped).toBe(true);
      expect(res.body.data.tokens).toBeDefined();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 2. PROVIDER RECEIVES ONLY REDACTED DATA & MAPPING STAYS INTERNAL
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Provider Isolation & Privacy Guarantees', () => {
    it('guarantees that external provider receives ONLY redacted data', async () => {
      const lead = await createLead(clinicA, {
        name: 'Sensitive Arthur Dent',
        email: 'secret.dent@galaxy.com',
        phone: '03009876543',
        notes: 'Arthur is staying at 742 Evergreen Terrace and requested an emergency filling.',
      });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.piiStripped).toBe(true);

      // Inspect intercepted prompt that was delivered to the provider
      const receivedPrompt = provider.getLastReceivedPrompt();
      expect(receivedPrompt).toBeDefined();

      // STRICT PROOF: Provider prompt must NEVER contain real PII
      expect(receivedPrompt).not.toContain('Sensitive Arthur Dent');
      expect(receivedPrompt).not.toContain('secret.dent@galaxy.com');
      expect(receivedPrompt).not.toContain('03009876543');
      expect(receivedPrompt).not.toContain('742 Evergreen Terrace');

      // It MUST contain anonymous tokens
      expect(receivedPrompt).toMatch(/\[NAME_\d+\]/);
      expect(receivedPrompt).toMatch(/\[PHONE_\d+\]/);
      expect(receivedPrompt).toMatch(/\[EMAIL_\d+\]/);
      expect(receivedPrompt).toMatch(/\[ADDRESS_\d+\]/);
    });

    it('proves mapping stays strictly internal and is never leaked via API responses', async () => {
      const lead = await createLead(clinicA, { name: 'Ford Prefect', phone: '03001112233' });
      const scoreRes = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(scoreRes.status).toBe(200);
      const jobId = scoreRes.body.data.id;

      // Fetch the job by ID
      const getRes = await request(app)
        .get(`/api/v1/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${clinicA.token}`);

      expect(getRes.status).toBe(200);
      // identityMap MUST be stripped from toJSON response
      expect(getRes.body.data.identityMap).toBeUndefined();
    });

    it('proves safe logger does not leak sensitive keys or raw prompts', () => {
      const sensitiveData = {
        prompt: 'Raw sensitive patient details',
        identityMap: { '[NAME_001]': 'John' },
        apiKey: 'secret_live_key',
        token: 'Bearer eyJhbGciOi...',
        normalField: 'ok',
      };

      const sanitized = aiLogger.sanitizeData(sensitiveData);
      expect(sanitized.prompt).toBe('[REDACTED_SENSITIVE_FIELD]');
      expect(sanitized.identityMap).toBe('[REDACTED_SENSITIVE_FIELD]');
      expect(sanitized.apiKey).toBe('[REDACTED_SENSITIVE_FIELD]');
      expect(sanitized.token).toBe('[REDACTED_SENSITIVE_FIELD]');
      expect(sanitized.normalField).toBe('ok');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. LEAD SCORING
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Lead Scoring', () => {
    it('scores a lead and returns validated structured results', async () => {
      const lead = await createLead(clinicA, {
        name: 'Trillian Astra',
        phone: '03005556677',
        notes: 'Looking for full mouth rehabilitation ASAP.',
      });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.jobType).toBe('lead_scoring');
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.output).toBeDefined();
      expect(res.body.data.output.score).toBeGreaterThanOrEqual(0);
      expect(res.body.data.output.score).toBeLessThanOrEqual(100);
      expect(res.body.data.output.intent).toBeDefined();
      expect(res.body.data.output.urgency).toBeDefined();
      expect(Array.isArray(res.body.data.output.recommendedActions)).toBe(true);
      expect(res.body.data.output.rationale).toBeDefined();
    });

    it('returns 404 when scoring a non-existent lead', async () => {
      const res = await request(app)
        .post('/api/v1/ai/leads/000000000000000000000001/score')
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 4. SUGGESTED REPLIES & HUMAN REVIEW (DRAFT / APPROVAL WORKFLOW)
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Suggested Replies & Human Review', () => {
    let convo;

    beforeEach(async () => {
      convo = await createConversation(clinicA, { channel: 'sms' });
      await postMessage(clinicA, convo.id, {
        body: 'Hello, I have severe toothache since yesterday. Can I come today?',
        senderType: 'contact',
        senderName: 'Patient Zaphod',
      });
    });

    it('generates a suggested reply and forces DRAFT state (in_review)', async () => {
      const res = await request(app)
        .post(`/api/v1/ai/conversations/${convo.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.jobType).toBe('suggested_reply');

      // CRITICAL: Must be in 'in_review' status (DRAFT), NEVER automatically approved
      expect(res.body.data.status).toBe('in_review');
      expect(res.body.data.rehydratedOutput).toBeDefined();
      expect(res.body.data.rehydratedOutput.suggestedReply).toBeDefined();
    });

    it('allows a human staff member to APPROVE a suggested reply', async () => {
      const genRes = await request(app)
        .post(`/api/v1/ai/conversations/${convo.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = genRes.body.data.id;

      const reviewRes = await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          action: 'approved',
          notes: 'Looks good, polite and accurate.',
        });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('approved');
      expect(reviewRes.body.data.reviewAction).toBe('approved');
      expect(reviewRes.body.data.reviewedBy).toBe(clinicA.userId);
      expect(reviewRes.body.data.reviewedAt).toBeDefined();
    });

    it('allows a human staff member to MODIFY a suggested reply', async () => {
      const genRes = await request(app)
        .post(`/api/v1/ai/conversations/${convo.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = genRes.body.data.id;
      const modifiedText = 'Hello Zaphod, please come in at 3 PM today. We have reserved emergency slot for you.';

      const reviewRes = await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          action: 'modified',
          modifiedReply: modifiedText,
          notes: 'Adjusted time slot to 3 PM emergency.',
        });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('approved');
      expect(reviewRes.body.data.reviewAction).toBe('modified');
      expect(reviewRes.body.data.rehydratedOutput.suggestedReply).toBe(modifiedText);
    });

    it('allows a human staff member to REJECT a suggested reply', async () => {
      const genRes = await request(app)
        .post(`/api/v1/ai/conversations/${convo.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = genRes.body.data.id;

      const reviewRes = await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({
          action: 'rejected',
          notes: 'Not relevant to patient inquiry.',
        });

      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('rejected');
      expect(reviewRes.body.data.reviewAction).toBe('rejected');
    });

    it('rejects reviewing a job that has already been reviewed', async () => {
      const genRes = await request(app)
        .post(`/api/v1/ai/conversations/${convo.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = genRes.body.data.id;

      // First review
      await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ action: 'approved' });

      // Second review attempt
      const secondReview = await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send({ action: 'rejected' });

      expect(secondReview.status).toBe(400);
      expect(secondReview.body.error.code).toBe('INVALID_JOB_STATE');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 5. OUTPUT VALIDATION & PROVIDER FAILURES
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Output Validation & Provider Failures', () => {
    it('handles provider connection failure gracefully and logs failed AIJob', async () => {
      provider.setSimulateFailure(true, 'OpenAI upstream gateway timeout', 'AI_PROVIDER_UNAVAILABLE');

      const lead = await createLead(clinicA, { name: 'Failure Test Lead' });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('AI_PROVIDER_UNAVAILABLE');

      // Confirm a failed AIJob was recorded for visibility
      const jobs = await AIJob.find({ clinicId: clinicA.clinicId, status: 'failed' });
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs[0].status).toBe('failed');
      expect(jobs[0].error.code).toBe('AI_PROVIDER_UNAVAILABLE');
    });

    it('handles provider timeout gracefully', async () => {
      provider.setSimulateTimeout(true);

      const lead = await createLead(clinicA, { name: 'Timeout Test Lead' });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_TIMEOUT');
    });

    it('handles malformed JSON from provider', async () => {
      provider.setSimulateMalformed(true);

      const lead = await createLead(clinicA, { name: 'Malformed Test Lead' });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_MALFORMED_OUTPUT');
    });

    it('handles invalid output schema (missing required fields)', async () => {
      // Missing 'score' and 'intent'
      provider.setCustomResponse({
        onlySomeRandomField: true,
      });

      const lead = await createLead(clinicA, { name: 'Invalid Schema Lead' });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${lead.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('AI_INVALID_OUTPUT');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 6. PROHIBITED CLINICAL ACTIONS
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Prohibited Operations', () => {
    it('blocks clinical diagnosis and prescription job types at the gateway level', async () => {
      await expect(
        AIGateway.executeJob({
          clinicId: clinicA.clinicId,
          jobType: 'clinical_diagnosis',
          rawPrompt: 'Diagnose this tooth pain',
        })
      ).rejects.toThrow();

      await expect(
        AIGateway.executeJob({
          clinicId: clinicA.clinicId,
          jobType: 'prescription',
          rawPrompt: 'Prescribe antibiotics',
        })
      ).rejects.toThrow();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 7. TENANT ISOLATION
  // ═════════════════════════════════════════════════════════════════════════════
  describe('Tenant Isolation: AI Workflows', () => {
    it('Clinic B cannot score Clinic A lead', async () => {
      const leadA = await createLead(clinicA, { name: 'Clinic A Lead' });

      const res = await request(app)
        .post(`/api/v1/ai/leads/${leadA.id}/score`)
        .set('Authorization', `Bearer ${clinicB.token}`)
        .send();

      expect(res.status).toBe(404);
    });

    it('Clinic B cannot generate suggested reply for Clinic A conversation', async () => {
      const convA = await createConversation(clinicA);
      await postMessage(clinicA, convA.id, { body: 'Inquiry' });

      const res = await request(app)
        .post(`/api/v1/ai/conversations/${convA.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicB.token}`)
        .send();

      expect(res.status).toBe(404);
    });

    it('Clinic B cannot view Clinic A AI Job by ID', async () => {
      const leadA = await createLead(clinicA, { name: 'Job Isolation Lead' });
      const scoreRes = await request(app)
        .post(`/api/v1/ai/leads/${leadA.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = scoreRes.body.data.id;

      const res = await request(app)
        .get(`/api/v1/ai/jobs/${jobId}`)
        .set('Authorization', `Bearer ${clinicB.token}`);

      expect(res.status).toBe(404);
    });

    it('Clinic B cannot review Clinic A AI Job', async () => {
      const convA = await createConversation(clinicA);
      await postMessage(clinicA, convA.id, { body: 'Inquiry' });

      const replyRes = await request(app)
        .post(`/api/v1/ai/conversations/${convA.id}/suggest-reply`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const jobId = replyRes.body.data.id;

      const res = await request(app)
        .post(`/api/v1/ai/jobs/${jobId}/review`)
        .set('Authorization', `Bearer ${clinicB.token}`)
        .send({ action: 'approved' });

      expect(res.status).toBe(404);
    });

    it('GET /api/v1/ai/jobs returns only the caller clinic AI jobs', async () => {
      const leadA = await createLead(clinicA, { name: 'A Lead' });
      await request(app)
        .post(`/api/v1/ai/leads/${leadA.id}/score`)
        .set('Authorization', `Bearer ${clinicA.token}`)
        .send();

      const res = await request(app)
        .get('/api/v1/ai/jobs')
        .set('Authorization', `Bearer ${clinicB.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // 8. RBAC: AUTHENTICATION
  // ═════════════════════════════════════════════════════════════════════════════
  describe('RBAC: AI Endpoints', () => {
    it('returns 401 for unauthenticated scoring request', async () => {
      const res = await request(app).post('/api/v1/ai/leads/000000000000000000000001/score').send();
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated suggest reply request', async () => {
      const res = await request(app)
        .post('/api/v1/ai/conversations/000000000000000000000001/suggest-reply')
        .send();
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated review request', async () => {
      const res = await request(app)
        .post('/api/v1/ai/jobs/000000000000000000000001/review')
        .send({ action: 'approved' });
      expect(res.status).toBe(401);
    });
  });
});
