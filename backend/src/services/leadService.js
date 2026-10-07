'use strict';

const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Patient = require('../models/Patient');
const AppError = require('../errors/AppError');

// ─── Lead Capture ─────────────────────────────────────────────────────────────

/**
 * Capture (create) a new lead for a clinic.
 * @param {string} clinicId
 * @param {object} data
 * @param {string|null} [actorUserId]
 * @returns {Promise<Lead>}
 */
async function captureLead(clinicId, data, actorUserId = null) {
  const {
    name,
    phone,
    email,
    source = 'other',
    referredBy,
    interestedIn,
    notes,
    ipAddress,
  } = data;

  if (!name || !name.trim()) {
    throw AppError.badRequest('Lead name is required.', 'VALIDATION_ERROR');
  }

  const lead = await Lead.create({
    clinicId,
    name: name.trim(),
    phone: phone ? phone.trim() : null,
    email: email ? email.toLowerCase().trim() : null,
    source,
    referredBy: referredBy || null,
    interestedIn: interestedIn || null,
    notes: notes || null,
    status: 'new',
    capturedBy: actorUserId || null,
    ipAddress: ipAddress || null,
    history: [
      {
        action: 'created',
        actor: actorUserId || null,
        toStatus: 'new',
        timestamp: new Date(),
      },
    ],
  });

  return lead;
}

// ─── Get Lead ─────────────────────────────────────────────────────────────────

/**
 * Fetch a single lead scoped to the clinic.
 * @param {string} clinicId
 * @param {string} leadId
 */
async function getLead(clinicId, leadId) {
  if (!mongoose.isValidObjectId(leadId)) {
    throw AppError.notFound('Lead not found.');
  }
  const lead = await Lead.findOne({ _id: leadId, clinicId });
  if (!lead) throw AppError.notFound('Lead not found.');
  return lead;
}

// ─── List / Search Leads ──────────────────────────────────────────────────────

/**
 * List leads with filtering, search, and pagination.
 * @param {string} clinicId
 * @param {object} opts
 * @param {string}  [opts.search]       – Free text on name/phone/email
 * @param {string}  [opts.status]       – Filter by status
 * @param {string}  [opts.source]       – Filter by source
 * @param {string}  [opts.assignedTo]   – Filter by assigned staff userId
 * @param {number}  [opts.page]         – 1-based page number
 * @param {number}  [opts.limit]        – Results per page (max 100)
 * @param {string}  [opts.sortBy]       – Field to sort
 * @param {string}  [opts.sortOrder]    – 'asc' | 'desc'
 */
async function listLeads(clinicId, opts = {}) {
  const {
    search,
    status,
    source,
    assignedTo,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = opts;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const allowedSortFields = ['name', 'status', 'source', 'createdAt', 'assignedAt', 'convertedAt'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const sortDir = sortOrder === 'asc' ? 1 : -1;

  const filter = { clinicId };

  if (status) filter.status = status;
  if (source) filter.source = source;

  if (assignedTo) {
    if (!mongoose.isValidObjectId(assignedTo)) {
      throw AppError.badRequest('Invalid assignedTo user ID.', 'VALIDATION_ERROR');
    }
    filter.assignedTo = new mongoose.Types.ObjectId(assignedTo);
  }

  if (search && search.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(safeLimit)
      .populate('assignedTo', 'firstName lastName email')
      .lean({ virtuals: true }),
    Lead.countDocuments(filter),
  ]);

  return {
    data: leads.map((l) => ({ ...l, id: l._id.toString() })),
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

// ─── Assign Lead ──────────────────────────────────────────────────────────────

/**
 * Assign a lead to a staff user.
 * @param {string} clinicId
 * @param {string} leadId
 * @param {string|null} assignToUserId  — null to unassign
 * @param {string} actorUserId
 */
async function assignLead(clinicId, leadId, assignToUserId, actorUserId) {
  const lead = await getLead(clinicId, leadId);

  if (lead.status === 'converted') {
    throw AppError.conflict(
      'Cannot reassign a converted lead.',
      'LEAD_ALREADY_CONVERTED'
    );
  }

  if (assignToUserId !== null && !mongoose.isValidObjectId(assignToUserId)) {
    throw AppError.badRequest('Invalid userId for assignment.', 'VALIDATION_ERROR');
  }

  const previousAssignee = lead.assignedTo;
  lead.assignedTo = assignToUserId
    ? new mongoose.Types.ObjectId(assignToUserId)
    : null;
  lead.assignedAt = assignToUserId ? new Date() : null;

  lead.history.push({
    action: 'assigned',
    actor: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
    note: assignToUserId
      ? `Assigned to user ${assignToUserId}`
      : `Unassigned (was ${previousAssignee})`,
    timestamp: new Date(),
  });

  await lead.save();
  return lead;
}

// ─── Update Lead Status ───────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'appointment_scheduled', 'lost'],
  qualified: ['appointment_scheduled', 'contacted', 'lost'],
  appointment_scheduled: ['converted', 'contacted', 'lost'],
  lost: ['new', 'contacted'],
  // converted is terminal — transitions out are prohibited here
};

/**
 * Update the status of a lead with transition validation.
 * @param {string} clinicId
 * @param {string} leadId
 * @param {string} newStatus
 * @param {string} actorUserId
 * @param {string} [note]
 */
async function updateLeadStatus(clinicId, leadId, newStatus, actorUserId, note) {
  const lead = await getLead(clinicId, leadId);

  if (lead.status === 'converted') {
    throw AppError.conflict(
      'Cannot change the status of a converted lead.',
      'LEAD_ALREADY_CONVERTED'
    );
  }

  const allowed = VALID_TRANSITIONS[lead.status] || [];
  if (!allowed.includes(newStatus)) {
    throw AppError.badRequest(
      `Invalid status transition from '${lead.status}' to '${newStatus}'.`,
      'INVALID_STATUS_TRANSITION'
    );
  }

  const fromStatus = lead.status;
  lead.status = newStatus;

  lead.history.push({
    action: 'status_changed',
    actor: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
    fromStatus,
    toStatus: newStatus,
    note: note || null,
    timestamp: new Date(),
  });

  await lead.save();
  return lead;
}

// ─── Add Note ─────────────────────────────────────────────────────────────────

/**
 * Append a freeform note to a lead's history.
 */
async function addLeadNote(clinicId, leadId, note, actorUserId) {
  if (!note || !note.trim()) {
    throw AppError.badRequest('Note text is required.', 'VALIDATION_ERROR');
  }

  const lead = await getLead(clinicId, leadId);

  lead.history.push({
    action: 'note_added',
    actor: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
    note: note.trim(),
    timestamp: new Date(),
  });

  await lead.save();
  return lead;
}

// ─── Update Lead Fields ───────────────────────────────────────────────────────

/**
 * Update mutable fields on a lead (not status — use updateLeadStatus for that).
 */
async function updateLead(clinicId, leadId, updates, actorUserId) {
  const lead = await getLead(clinicId, leadId);

  if (lead.status === 'converted') {
    throw AppError.conflict(
      'Cannot edit a converted lead.',
      'LEAD_ALREADY_CONVERTED'
    );
  }

  const allowedFields = ['name', 'phone', 'email', 'source', 'referredBy', 'interestedIn', 'notes'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      lead[field] = field === 'email' && updates[field]
        ? updates[field].toLowerCase().trim()
        : updates[field];
    }
  }

  await lead.save();
  return lead;
}

// ─── Lead Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a lead to a patient using a MongoDB transaction to ensure atomicity.
 *
 * Behaviour:
 *  - Prevents duplicate conversion (idempotent check).
 *  - Optionally creates a new Patient record OR links to an existing one.
 *  - Preserves full lead history.
 *  - Updates lead status to 'converted'.
 *  - Records conversion metadata on both lead and patient.
 *
 * @param {string} clinicId
 * @param {string} leadId
 * @param {object} opts
 * @param {string}  [opts.existingPatientId]  – Link to an existing patient
 * @param {object}  [opts.patientData]         – Data for creating a new patient
 * @param {string}  actorUserId
 * @returns {Promise<{lead: Lead, patient: Patient}>}
 */
async function convertLeadToPatient(clinicId, leadId, opts, actorUserId) {
  const { existingPatientId, patientData } = opts;

  // Validate before starting transaction
  const lead = await getLead(clinicId, leadId);

  if (lead.status === 'converted' || lead.patientId) {
    throw AppError.conflict(
      'Lead has already been converted to a patient.',
      'LEAD_ALREADY_CONVERTED'
    );
  }

  if (existingPatientId && !mongoose.isValidObjectId(existingPatientId)) {
    throw AppError.badRequest('Invalid existingPatientId.', 'VALIDATION_ERROR');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let patient;

    if (existingPatientId) {
      // ── Link to existing patient ───────────────────────────────────────
      patient = await Patient.findOne({ _id: existingPatientId, clinicId }).session(session);
      if (!patient) {
        throw AppError.notFound('Existing patient not found within this clinic.');
      }

      // Guard against linking the same patient to two different leads
      const alreadyLinked = await Lead.findOne({
        clinicId,
        patientId: patient._id,
        _id: { $ne: lead._id },
      }).session(session);

      if (alreadyLinked) {
        throw AppError.conflict(
          'This patient is already linked to another lead.',
          'PATIENT_ALREADY_LINKED'
        );
      }
    } else {
      // ── Create new patient from lead data ──────────────────────────────
      if (!patientData && !lead.name) {
        throw AppError.badRequest('Patient data is required to convert lead.', 'VALIDATION_ERROR');
      }

      const mergedData = {
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        ...(patientData || {}),
      };

      if (!mergedData.name || !mergedData.name.trim()) {
        throw AppError.badRequest('Patient name is required for conversion.', 'VALIDATION_ERROR');
      }

      // Generate patient number atomically
      const last = await Patient.findOne({ clinicId })
        .sort({ patientNo: -1 })
        .select('patientNo')
        .lean()
        .session(session);

      let nextNum = 1;
      if (last && last.patientNo) {
        const match = last.patientNo.match(/\d+$/);
        if (match) nextNum = parseInt(match[0], 10) + 1;
      }

      const patientNo = `PT-${String(nextNum).padStart(5, '0')}`;

      const [createdPatient] = await Patient.create(
        [
          {
            clinicId,
            patientNo,
            name: mergedData.name.trim(),
            phone: mergedData.phone || null,
            email: mergedData.email ? mergedData.email.toLowerCase().trim() : null,
            DOB: mergedData.DOB ? new Date(mergedData.DOB) : null,
            gender: mergedData.gender || null,
            address: mergedData.address || {},
            emergencyContact: mergedData.emergencyContact || {},
            medicalAlerts: [],
            status: 'active',
          },
        ],
        { session }
      );
      patient = createdPatient;
    }

    // ── Update the lead (within same transaction) ──────────────────────
    const now = new Date();

    await Lead.updateOne(
      { _id: lead._id, clinicId },
      {
        $set: {
          status: 'converted',
          convertedAt: now,
          convertedBy: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
          patientId: patient._id,
        },
        $push: {
          history: {
            _id: new mongoose.Types.ObjectId(),
            action: 'converted',
            actor: actorUserId ? new mongoose.Types.ObjectId(actorUserId) : null,
            fromStatus: lead.status,
            toStatus: 'converted',
            note: `Converted to patient ${patient._id}`,
            metadata: { patientId: patient._id.toString() },
            timestamp: now,
          },
        },
      },
      { session }
    );

    await session.commitTransaction();

    // Return fresh copies
    const updatedLead = await Lead.findById(lead._id);
    return { lead: updatedLead, patient };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = {
  captureLead,
  getLead,
  listLeads,
  assignLead,
  updateLeadStatus,
  updateLead,
  addLeadNote,
  convertLeadToPatient,
};
