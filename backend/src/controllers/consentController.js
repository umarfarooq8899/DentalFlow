'use strict';

const { z } = require('zod');
const consentService = require('../services/consentService');

// ─── Validation Schemas ────────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  type: z.string().trim().min(1, 'type is required'),
  title: z.string().trim().min(1, 'title is required'),
  content: z.string().trim().min(1, 'content is required'),
});

const recordConsentSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  templateId: z.string().min(1, 'templateId is required'),
  signedByName: z.string().trim().min(1, 'signedByName is required'),
  signedAt: z.string().min(1, 'signedAt is required'),
  method: z.enum(['digital', 'paper', 'verbal']),
  documentRef: z.string().optional().nullable(),
});

// ─── Template Handlers ─────────────────────────────────────────────────────────

async function createConsentTemplateHandler(req, res, next) {
  try {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const template = await consentService.createConsentTemplate(req.user.clinicId, {
      ...parsed.data,
      publishedBy: req.user.id,
    });
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
}

async function listConsentTemplatesHandler(req, res, next) {
  try {
    const { type, activeOnly } = req.query;
    const templates = await consentService.listConsentTemplates(req.user.clinicId, {
      type,
      activeOnly: activeOnly === 'true',
    });
    res.status(200).json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
}

async function getConsentTemplateHandler(req, res, next) {
  try {
    const template = await consentService.getConsentTemplate(req.user.clinicId, req.params.templateId);
    res.status(200).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
}

// ─── Signed Consent Form Handlers ─────────────────────────────────────────────

async function recordSignedConsentHandler(req, res, next) {
  try {
    const parsed = recordConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const form = await consentService.recordSignedConsent(req.user.clinicId, parsed.data);
    res.status(201).json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

async function listPatientConsentsHandler(req, res, next) {
  try {
    const { type } = req.query;
    const forms = await consentService.listPatientConsents(
      req.user.clinicId,
      req.params.patientId,
      { type }
    );
    res.status(200).json({ success: true, data: forms });
  } catch (err) {
    next(err);
  }
}

async function getConsentFormHandler(req, res, next) {
  try {
    const form = await consentService.getConsentForm(req.user.clinicId, req.params.consentId);
    res.status(200).json({ success: true, data: form });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createConsentTemplateHandler,
  listConsentTemplatesHandler,
  getConsentTemplateHandler,
  recordSignedConsentHandler,
  listPatientConsentsHandler,
  getConsentFormHandler,
};
