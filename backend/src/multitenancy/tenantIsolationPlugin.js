'use strict';

const { getCurrentClinicId } = require('./tenantContext');

/**
 * Mongoose plugin that automatically scopes all queries and documents
 * to the current tenant (clinic).
 *
 * @param {import('mongoose').Schema} schema
 */
function tenantIsolationPlugin(schema) {
  // Add clinicId field to every schema that uses this plugin
  schema.add({
    clinicId: {
      type: String,
      required: true,
      index: true,
    },
  });

  // --- Document middleware ---

  // Automatically set clinicId on save
  schema.pre('save', function (next) {
    if (!this.clinicId) {
      const clinicId = getCurrentClinicId();
      if (clinicId) {
        this.clinicId = clinicId;
      } else {
        return next(new Error('Tenant context is not set. Cannot save document without clinicId.'));
      }
    }
    next();
  });

  // --- Query middleware ---

  const queryMiddlewares = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'count',
    'countDocuments',
    'exists',
  ];

  queryMiddlewares.forEach((method) => {
    schema.pre(method, function () {
      const clinicId = getCurrentClinicId();
      if (clinicId && !this.getQuery().clinicId) {
        this.where({ clinicId });
      }
    });
  });

  // --- Aggregate middleware ---
  schema.pre('aggregate', function () {
    const clinicId = getCurrentClinicId();
    if (clinicId) {
      this.pipeline().unshift({ $match: { clinicId } });
    }
  });
}

module.exports = { tenantIsolationPlugin };
