'use strict';

const request = require('supertest');
const app = require('../src/app');
const Notification = require('../src/models/Notification');
const Recall = require('../src/models/Recall');
const notificationService = require('../src/services/notificationService');
const { handleFailedNotificationJob } = require('../src/jobs/notificationWorker');
const { NOTIFICATION_JOB_DEFAULTS } = require('../src/jobs/notificationQueue');

async function registerAndLogin(clinicSlug, email) {
  await request(app).post('/api/v1/auth/register').send({
    clinicName: `Clinic ${clinicSlug}`,
    clinicSlug,
    email,
    password: 'Password123!',
    firstName: 'Recall',
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

async function createPatient(auth, overrides = {}) {
  const response = await request(app)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      name: 'Recall Patient',
      email: 'recall-patient@test.com',
      phone: '555-0199',
      ...overrides,
    });
  return response.body.data;
}

async function createDentist(auth) {
  const response = await request(app)
    .post('/api/v1/dentists')
    .set('Authorization', `Bearer ${auth.token}`)
    .send({ userId: auth.userId, specialty: 'General Dentistry', licenseInfo: 'RECALL-123' });
  return response.body.data;
}

describe('TASK 7 — Notifications, Appointment Reminders & Recalls', () => {
  let clinicA;
  let clinicB;
  let patientA;

  beforeEach(async () => {
    clinicA = await registerAndLogin('notify-clinic-a', 'notify-a@test.com');
    clinicB = await registerAndLogin('notify-clinic-b', 'notify-b@test.com');
    patientA = await createPatient(clinicA);
  });

  it('configures retryable BullMQ jobs with exponential backoff', () => {
    expect(NOTIFICATION_JOB_DEFAULTS.attempts).toBeGreaterThan(1);
    expect(NOTIFICATION_JOB_DEFAULTS.backoff).toEqual(expect.objectContaining({ type: 'exponential' }));
    expect(NOTIFICATION_JOB_DEFAULTS.backoff.delay).toBeGreaterThan(0);
    expect(NOTIFICATION_JOB_DEFAULTS.removeOnFail).toBe(false);
  });

  it('persists and enqueues notifications, deduplicating repeated requests', async () => {
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const create = () => request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'manual-notification-001')
      .send({
        patientId: patientA.id,
        recipient: patientA.email,
        channel: 'email',
        subject: 'Visit reminder',
        message: 'Please confirm your upcoming visit.',
        scheduledAt,
      });

    const first = await create();
    const duplicate = await create();
    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.isDuplicate).toBe(true);
    expect(first.body.data.id).toBe(duplicate.body.data.id);
    expect(first.body.data.status).toBe('queued');
    expect(await Notification.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
    expect(global.__notificationJobs.size).toBe(1);

    const listed = await request(app)
      .get('/api/v1/notifications?patientId=' + patientA.id)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const delivered = jest.fn().mockResolvedValue(undefined);
    await notificationService.processNotificationJob({
      clinicId: clinicA.clinicId,
      notificationId: first.body.data.id,
    }, delivered);
    expect(delivered).toHaveBeenCalledTimes(1);
    const saved = await Notification.findById(first.body.data.id);
    expect(saved.status).toBe('sent');
    expect(saved.attempts).toBe(1);
    expect(saved.sentAt).toBeInstanceOf(Date);
  });

  it('rejects reusing a notification idempotency key with a different payload', async () => {
    const post = (message) => request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'notification-key-mismatch')
      .send({ patientId: patientA.id, recipient: patientA.email, channel: 'email', message });
    expect((await post('First message')).status).toBe(202);
    const mismatch = await post('Different message');
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('creates only one persisted notification and queue job for concurrent duplicate requests', async () => {
    const create = () => request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'concurrent-notification-001')
      .send({ patientId: patientA.id, recipient: patientA.email, channel: 'email', message: 'Immediate reminder' });
    const responses = await Promise.all([create(), create()]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 202]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    expect(await Notification.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
    expect(global.__notificationJobs.size).toBe(1);
  });

  it('records retry attempts and sends after a transient delivery failure', async () => {
    const created = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'retry-notification-001')
      .send({ patientId: patientA.id, recipient: patientA.email, channel: 'email', message: 'Recall check-in' });
    const jobData = { clinicId: clinicA.clinicId, notificationId: created.body.data.id };
    const transientError = Object.assign(new Error('provider failure with private content'), { code: 'TEMPORARY_PROVIDER_FAILURE' });
    const deadLetterQueue = { add: jest.fn() };
    const firstJob = { id: created.body.data.id, data: jobData, attemptsMade: 1, opts: { attempts: 3 } };

    await expect(notificationService.processNotificationJob(jobData, async () => { throw transientError; })).rejects.toThrow();
    await handleFailedNotificationJob(firstJob, transientError, deadLetterQueue);
    let saved = await Notification.findById(created.body.data.id);
    expect(saved.status).toBe('queued');
    expect(saved.attempts).toBe(1);
    expect(saved.error.message).toBe('Notification delivery failed.');
    expect(deadLetterQueue.add).not.toHaveBeenCalled();

    await notificationService.processNotificationJob(jobData, jest.fn().mockResolvedValue(undefined));
    saved = await Notification.findById(created.body.data.id);
    expect(saved.status).toBe('sent');
    expect(saved.attempts).toBe(2);
  });

  it('marks exhausted jobs failed and places them in the dead-letter queue', async () => {
    const created = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'failed-notification-001')
      .send({ patientId: patientA.id, recipient: patientA.email, channel: 'email', message: 'Recall follow-up' });
    const jobData = { clinicId: clinicA.clinicId, notificationId: created.body.data.id };
    const error = Object.assign(new Error('delivery unavailable'), { code: 'DELIVERY_UNAVAILABLE' });
    const deadLetterQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const job = { id: created.body.data.id, data: jobData, attemptsMade: 5, opts: { attempts: 5 } };

    await notificationService.processNotificationJob(jobData, async () => { throw error; }).catch(() => {});
    await handleFailedNotificationJob(job, error, deadLetterQueue);
    const saved = await Notification.findById(created.body.data.id);
    expect(saved.status).toBe('failed');
    expect(saved.failedAt).toBeInstanceOf(Date);
    expect(deadLetterQueue.add).toHaveBeenCalledWith(
      'failed-notification',
      expect.objectContaining({ notificationId: created.body.data.id, errorCode: 'DELIVERY_UNAVAILABLE' }),
      expect.objectContaining({ jobId: `failed-${created.body.data.id}` })
    );
  });

  it('schedules appointment reminders after appointment creation', async () => {
    const dentist = await createDentist(clinicA);
    const nextMonday = new Date();
    nextMonday.setUTCDate(nextMonday.getUTCDate() + ((1 + 7 - nextMonday.getUTCDay()) % 7 || 7));
    nextMonday.setUTCHours(10, 0, 0, 0);
    const created = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({
        patientId: patientA.id,
        dentistId: dentist.id,
        startAt: nextMonday.toISOString(),
        endAt: new Date(nextMonday.getTime() + 60 * 60 * 1000).toISOString(),
      });

    expect(created.status).toBe(201);
    const notification = await Notification.findOne({
      clinicId: clinicA.clinicId,
      relatedResourceType: 'appointment',
      relatedResourceId: created.body.data.id,
    });
    expect(notification).not.toBeNull();
    expect(notification.channel).toBe('email');
    expect(notification.scheduledAt.getTime()).toBeLessThan(nextMonday.getTime());
    expect(global.__notificationJobs.has(String(notification._id))).toBe(true);
  });

  it('schedules recalls idempotently and tracks next action and contact state', async () => {
    const dueAt = new Date(Date.now() + 2 * 86400_000).toISOString();
    const nextActionAt = new Date(Date.now() + 86400_000).toISOString();
    const create = () => request(app)
      .post('/api/v1/recalls')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'recall-create-001')
      .send({ patientId: patientA.id, dueAt, nextActionAt, reason: 'Six-month checkup' });
    const first = await create();
    const duplicate = await create();

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.isDuplicate).toBe(true);
    expect(first.body.data.nextActionAt).toBe(nextActionAt);
    expect(await Recall.countDocuments({ clinicId: clinicA.clinicId })).toBe(1);
    expect(await Notification.countDocuments({ clinicId: clinicA.clinicId, relatedResourceType: 'recall' })).toBe(1);
    expect(global.__notificationJobs.size).toBe(1);

    const listed = await request(app)
      .get('/api/v1/recalls?patientId=' + patientA.id)
      .set('Authorization', `Bearer ${clinicA.token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const contacted = await request(app)
      .patch(`/api/v1/recalls/${first.body.data.id}`)
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({ status: 'contacted' });
    expect(contacted.status).toBe(200);
    expect(contacted.body.data.status).toBe('contacted');
    expect(contacted.body.data.lastContactedAt).not.toBeNull();
  });

  it('cancels an old queued recall notification after its next action is rescheduled', async () => {
    const firstAction = new Date(Date.now() + 86400_000);
    const recallResponse = await request(app)
      .post('/api/v1/recalls')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'recall-reschedule-001')
      .send({ patientId: patientA.id, dueAt: firstAction.toISOString(), nextActionAt: firstAction.toISOString() });
    const recallId = recallResponse.body.data.id;
    const oldNotification = await Notification.findOne({ relatedResourceId: recallId });
    const newAction = new Date(firstAction.getTime() + 86400_000);

    const update = await request(app)
      .patch(`/api/v1/recalls/${recallId}`)
      .set('Authorization', `Bearer ${clinicA.token}`)
      .send({ nextActionAt: newAction.toISOString() });
    expect(update.status).toBe(200);
    expect(await Notification.countDocuments({ relatedResourceId: recallId })).toBe(2);

    const deliver = jest.fn().mockResolvedValue(undefined);
    const result = await notificationService.processNotificationJob({
      clinicId: clinicA.clinicId,
      notificationId: String(oldNotification._id),
    }, deliver);
    expect(result.skipped).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
    expect((await Notification.findById(oldNotification._id)).status).toBe('cancelled');
  });

  it('isolates notification and recall retrieval by clinic', async () => {
    const notification = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'tenant-notification-001')
      .send({ patientId: patientA.id, recipient: patientA.email, channel: 'email', message: 'Tenant check' });
    const recall = await request(app)
      .post('/api/v1/recalls')
      .set('Authorization', `Bearer ${clinicA.token}`)
      .set('Idempotency-Key', 'tenant-recall-001')
      .send({ patientId: patientA.id, dueAt: new Date(Date.now() + 86400_000).toISOString() });

    const notificationAccess = await request(app)
      .get(`/api/v1/notifications/${notification.body.data.id}`)
      .set('Authorization', `Bearer ${clinicB.token}`);
    const recallAccess = await request(app)
      .get(`/api/v1/recalls/${recall.body.data.id}`)
      .set('Authorization', `Bearer ${clinicB.token}`);
    expect(notificationAccess.status).toBe(404);
    expect(recallAccess.status).toBe(404);
  });
});