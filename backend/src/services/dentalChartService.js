'use strict';

const mongoose = require('mongoose');
const DentalChart = require('../models/DentalChart');
const Patient = require('../models/Patient');
const AppError = require('../errors/AppError');
const {
  isValidToothNumber,
  ALL_TOOTH_CONDITIONS,
  ALL_TOOTH_SURFACES,
  ALL_CHART_ENTRY_STATUSES,
  ChartEntryStatus,
  ToothCondition,
} = require('@dentalflow/shared');

/**
 * Record a tooth condition entry in an append-only manner.
 * If an entry already exists for this tooth or supersedesId is specified,
 * it builds the supersedes chain without mutating historical data.
 */
async function recordToothCondition(clinicId, {
  patientId,
  toothNumber,
  condition,
  surfaces = [],
  notes = '',
  status = ChartEntryStatus.ACTIVE,
  visitDate = new Date(),
  updatedBy,
  supersedesId = null,
}) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    throw AppError.badRequest('Invalid patientId.');
  }

  const patient = await Patient.findOne({ _id: patientId, clinicId });
  if (!patient) {
    throw AppError.notFound('Patient not found.');
  }

  if (!isValidToothNumber(toothNumber)) {
    throw AppError.badRequest(`Invalid tooth number: ${toothNumber}. Must be 1-32 Universal Numbering System.`);
  }

  if (condition && !ALL_TOOTH_CONDITIONS.includes(condition)) {
    throw AppError.badRequest(`Invalid tooth condition: '${condition}'.`);
  }

  if (Array.isArray(surfaces)) {
    for (const s of surfaces) {
      if (!ALL_TOOTH_SURFACES.includes(s.toUpperCase())) {
        throw AppError.badRequest(`Invalid tooth surface: '${s}'. Valid surfaces: ${ALL_TOOTH_SURFACES.join(', ')}.`);
      }
    }
  }

  if (status && !ALL_CHART_ENTRY_STATUSES.includes(status)) {
    throw AppError.badRequest(`Invalid chart entry status: '${status}'.`);
  }

  let finalSupersedesId = supersedesId;

  if (supersedesId) {
    if (!mongoose.Types.ObjectId.isValid(supersedesId)) {
      throw AppError.badRequest('Invalid supersedesId.');
    }
    const previous = await DentalChart.findOne({
      _id: supersedesId,
      clinicId,
      patientId,
      toothNumber,
    });
    if (!previous) {
      throw AppError.badRequest(
        `Previous chart record with id ${supersedesId} not found for tooth #${toothNumber}.`
      );
    }
  } else {
    // If not explicitly provided, find the current active / latest record for this tooth
    // to keep the supersedes chain contiguous
    const latest = await DentalChart.findOne({
      clinicId,
      patientId,
      toothNumber,
    }).sort({ visitDate: -1, createdAt: -1 });

    if (latest) {
      finalSupersedesId = latest._id;
    }
  }

  // Create append-only entry
  const entry = await DentalChart.create({
    clinicId,
    patientId,
    toothNumber,
    condition: condition || ToothCondition.HEALTHY,
    surfaces: (surfaces || []).map((s) => s.toUpperCase()),
    notes,
    status: status || ChartEntryStatus.ACTIVE,
    visitDate: new Date(visitDate),
    updatedBy,
    supersedesId: finalSupersedesId,
  });

  return entry;
}

/**
 * Reconstruct the exact dental chart state as of a specified date.
 * Reconstructs the state by traversing supersedes chains valid up to that date.
 *
 * @param {string} clinicId
 * @param {string} patientId
 * @param {Date|string} asOfDate
 */
async function getDentalChartStateAsOf(clinicId, patientId, asOfDate) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    throw AppError.badRequest('Invalid patientId.');
  }

  const patient = await Patient.findOne({ _id: patientId, clinicId });
  if (!patient) {
    throw AppError.notFound('Patient not found.');
  }

  const targetDate = new Date(asOfDate);
  if (isNaN(targetDate.getTime())) {
    throw AppError.badRequest('Invalid asOfDate provided.');
  }

  // Fetch all records for this patient up to targetDate
  const records = await DentalChart.find({
    clinicId,
    patientId,
    visitDate: { $lte: targetDate },
  })
    .sort({ visitDate: 1, createdAt: 1 })
    .populate('updatedBy', 'name email role')
    .lean();

  if (records.length === 0) {
    return {
      patientId,
      asOfDate: targetDate.toISOString(),
      activeEntriesCount: 0,
      teeth: {},
      entries: [],
    };
  }

  // A record in this point-in-time set was superseded IF another record
  // in this SAME point-in-time set references it via supersedesId.
  const supersededIdSet = new Set();
  for (const rec of records) {
    if (rec.supersedesId) {
      supersededIdSet.add(rec.supersedesId.toString());
    }
  }

  // Active records as of targetDate: records whose _id is NOT in supersededIdSet
  const activeRecords = records.filter(
    (rec) => !supersededIdSet.has(rec._id.toString())
  );

  // Group by toothNumber (in case of multiple entries, latest visitDate/createdAt wins)
  const teethMap = {};
  for (const rec of activeRecords) {
    const toothNum = rec.toothNumber;
    if (
      !teethMap[toothNum] ||
      new Date(rec.visitDate) > new Date(teethMap[toothNum].visitDate) ||
      (new Date(rec.visitDate).getTime() === new Date(teethMap[toothNum].visitDate).getTime() &&
        new Date(rec.createdAt) > new Date(teethMap[toothNum].createdAt))
    ) {
      teethMap[toothNum] = rec;
    }
  }

  const entries = Object.values(teethMap);

  return {
    patientId,
    asOfDate: targetDate.toISOString(),
    activeEntriesCount: entries.length,
    teeth: teethMap,
    entries,
  };
}

/**
 * Get current active dental chart (as of right now).
 */
async function getCurrentDentalChart(clinicId, patientId) {
  return getDentalChartStateAsOf(clinicId, patientId, new Date());
}

/**
 * Retrieve the complete historical supersedes chain for a single tooth.
 */
async function getToothHistory(clinicId, patientId, toothNumber) {
  if (!mongoose.Types.ObjectId.isValid(patientId)) {
    throw AppError.badRequest('Invalid patientId.');
  }

  const tooth = Number(toothNumber);
  if (!isValidToothNumber(tooth)) {
    throw AppError.badRequest(`Invalid tooth number: ${toothNumber}. Must be 1-32.`);
  }

  const patient = await Patient.findOne({ _id: patientId, clinicId });
  if (!patient) {
    throw AppError.notFound('Patient not found.');
  }

  const history = await DentalChart.find({
    clinicId,
    patientId,
    toothNumber: tooth,
  })
    .sort({ visitDate: 1, createdAt: 1 })
    .populate('updatedBy', 'name email role')
    .lean();

  return history;
}

module.exports = {
  recordToothCondition,
  getDentalChartStateAsOf,
  getCurrentDentalChart,
  getToothHistory,
};
