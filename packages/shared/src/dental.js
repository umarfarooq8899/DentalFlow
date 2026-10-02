'use strict';

/**
 * Universal Numbering System (UNS) 1-32 for adult permanent dentition.
 */
const MIN_TOOTH_NUMBER = 1;
const MAX_TOOTH_NUMBER = 32;

function isValidToothNumber(toothNumber) {
  if (typeof toothNumber !== 'number' || !Number.isInteger(toothNumber)) {
    return false;
  }
  return toothNumber >= MIN_TOOTH_NUMBER && toothNumber <= MAX_TOOTH_NUMBER;
}

const ToothCondition = {
  HEALTHY: 'healthy',
  CARIES: 'caries',
  FILLED: 'filled',
  MISSING: 'missing',
  IMPACTED: 'impacted',
  CROWN: 'crown',
  ROOT_CANAL: 'root_canal',
  BRIDGE: 'bridge',
  IMPLANT: 'implant',
  FRACTURED: 'fractured',
  EXTRACTED: 'extracted',
  VENEER: 'veneer',
  OTHER: 'other',
};

const ALL_TOOTH_CONDITIONS = Object.values(ToothCondition);

const ToothSurface = {
  MESIAL: 'M',
  DISTAL: 'D',
  OCCLUSAL: 'O',
  INCISAL: 'I',
  BUCCAL: 'B',
  FACIAL: 'F',
  LINGUAL: 'L',
};

const ALL_TOOTH_SURFACES = Object.values(ToothSurface);

const ChartEntryStatus = {
  ACTIVE: 'active',
  PLANNED: 'planned',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
};

const ALL_CHART_ENTRY_STATUSES = Object.values(ChartEntryStatus);

const TreatmentPlanStatus = {
  DRAFT: 'draft',
  PRESENTED: 'presented',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};

const ALL_TREATMENT_PLAN_STATUSES = Object.values(TreatmentPlanStatus);

const TreatmentProcedureStatus = {
  PLANNED: 'planned',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const ALL_TREATMENT_PROCEDURE_STATUSES = Object.values(TreatmentProcedureStatus);

const PaymentMethod = {
  CASH: 'cash',
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
  BANK_TRANSFER: 'bank_transfer',
  INSURANCE: 'insurance',
  OTHER: 'other',
};

const ALL_PAYMENT_METHODS = Object.values(PaymentMethod);

/**
 * Invoice lifecycle status:
 *   draft → issued → partially_paid → paid → voided
 * Voided is a terminal state. Paid is terminal unless refunded (future).
 */
const InvoiceStatus = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  VOIDED: 'voided',
  OVERDUE: 'overdue',
};

const ALL_INVOICE_STATUSES = Object.values(InvoiceStatus);

/**
 * Valid server-side status transitions.
 * Keys = current status, values = allowed next statuses.
 */
const INVOICE_STATUS_TRANSITIONS = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.ISSUED, InvoiceStatus.VOIDED],
  [InvoiceStatus.ISSUED]: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.VOIDED, InvoiceStatus.OVERDUE],
  [InvoiceStatus.PARTIALLY_PAID]: [InvoiceStatus.PAID, InvoiceStatus.VOIDED, InvoiceStatus.OVERDUE],
  [InvoiceStatus.OVERDUE]: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.VOIDED],
  [InvoiceStatus.PAID]: [], // Terminal
  [InvoiceStatus.VOIDED]: [], // Terminal
};

const InvoiceItemType = {
  PROCEDURE: 'procedure',
  DISCOUNT: 'discount',
  TAX: 'tax',
  FEE: 'fee',
  OTHER: 'other',
};

const ALL_INVOICE_ITEM_TYPES = Object.values(InvoiceItemType);

module.exports = {
  MIN_TOOTH_NUMBER,
  MAX_TOOTH_NUMBER,
  isValidToothNumber,
  ToothCondition,
  ALL_TOOTH_CONDITIONS,
  ToothSurface,
  ALL_TOOTH_SURFACES,
  ChartEntryStatus,
  ALL_CHART_ENTRY_STATUSES,
  TreatmentPlanStatus,
  ALL_TREATMENT_PLAN_STATUSES,
  TreatmentProcedureStatus,
  ALL_TREATMENT_PROCEDURE_STATUSES,
  PaymentMethod,
  ALL_PAYMENT_METHODS,
  InvoiceStatus,
  ALL_INVOICE_STATUSES,
  INVOICE_STATUS_TRANSITIONS,
  InvoiceItemType,
  ALL_INVOICE_ITEM_TYPES,
};
