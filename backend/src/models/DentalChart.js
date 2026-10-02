'use strict';

const mongoose = require('mongoose');
const { tenantIsolationPlugin } = require('../multitenancy/tenantIsolationPlugin');
const {
  isValidToothNumber,
  ALL_TOOTH_CONDITIONS,
  ALL_TOOTH_SURFACES,
  ALL_CHART_ENTRY_STATUSES,
  ChartEntryStatus,
  ToothCondition,
} = require('@dentalflow/shared');

const dentalChartSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
      index: true,
    },
    toothNumber: {
      type: Number,
      required: true,
      validate: {
        validator: isValidToothNumber,
        message: (props) => `${props.value} is not a valid tooth number (must be 1-32 Universal Numbering System).`,
      },
    },
    condition: {
      type: String,
      required: true,
      trim: true,
      enum: ALL_TOOTH_CONDITIONS,
      default: ToothCondition.HEALTHY,
    },
    surfaces: [
      {
        type: String,
        trim: true,
        uppercase: true,
        enum: ALL_TOOTH_SURFACES,
      },
    ],
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      enum: ALL_CHART_ENTRY_STATUSES,
      default: ChartEntryStatus.ACTIVE,
    },
    visitDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    supersedesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DentalChart',
      default: null,
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
  }
);

// Apply tenant isolation
dentalChartSchema.plugin(tenantIsolationPlugin);

// Compound indexes
dentalChartSchema.index({ clinicId: 1, patientId: 1, toothNumber: 1 });
dentalChartSchema.index({ clinicId: 1, patientId: 1, visitDate: -1 });
dentalChartSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
dentalChartSchema.index({ clinicId: 1, supersedesId: 1 });

// Prevent silent in-place mutation of existing historical chart entries
const blockedMutations = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne'];
blockedMutations.forEach((method) => {
  dentalChartSchema.pre(method, function () {
    // Check if an explicit bypass internal flag is provided (e.g. for archiving or tests)
    const options = this.getOptions ? this.getOptions() : {};
    if (!options.allowImmutableMutation) {
      throw new Error(
        'DentalChart records are append-only and immutable. Create a new entry with supersedesId instead of mutating historical records.'
      );
    }
  });
});

const DentalChart = mongoose.model('DentalChart', dentalChartSchema);

module.exports = DentalChart;
