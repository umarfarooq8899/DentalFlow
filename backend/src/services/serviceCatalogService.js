'use strict';

const Service = require('../models/Service');
const AppError = require('../errors/AppError');

/**
 * Create a new service for the clinic.
 */
async function createService(clinicId, { name, category = 'General', durationMinutes, duration, price }) {
  const finalDuration = durationMinutes !== undefined ? durationMinutes : duration;

  if (!name || !name.trim()) {
    throw AppError.badRequest('Service name is required.');
  }
  if (finalDuration === undefined || Number(finalDuration) <= 0) {
    throw AppError.badRequest('Duration in minutes must be a positive number.');
  }
  if (price === undefined || Number(price) < 0) {
    throw AppError.badRequest('Price must be a non-negative number.');
  }

  const service = await Service.create({
    clinicId,
    name: name.trim(),
    category: category.trim(),
    durationMinutes: Number(finalDuration),
    price: Number(price),
    active: true,
  });

  return service;
}

/**
 * Get service by ID within clinic scope.
 */
async function getServiceById(clinicId, serviceId) {
  const service = await Service.findOne({ _id: serviceId, clinicId });
  if (!service) {
    throw AppError.notFound('Service not found.');
  }
  return service;
}

/**
 * Update service details.
 */
async function updateService(clinicId, serviceId, updateData) {
  const { _id, clinicId: ignored, ...safeUpdates } = updateData;

  if (safeUpdates.duration !== undefined && safeUpdates.durationMinutes === undefined) {
    safeUpdates.durationMinutes = safeUpdates.duration;
    delete safeUpdates.duration;
  }

  const service = await Service.findOneAndUpdate(
    { _id: serviceId, clinicId },
    { $set: safeUpdates },
    { new: true, runValidators: true }
  );

  if (!service) {
    throw AppError.notFound('Service not found.');
  }
  return service;
}

/**
 * Archive / Deactivate a service.
 * Never hard-delete so historical appointments and invoices retain referential integrity.
 */
async function archiveService(clinicId, serviceId) {
  const service = await Service.findOne({ _id: serviceId, clinicId });
  if (!service) {
    throw AppError.notFound('Service not found.');
  }

  service.active = false;
  service.archivedAt = new Date();
  await service.save();

  return service;
}

/**
 * List and search services within clinic scope.
 */
async function listServices(clinicId, { search, category, activeOnly } = {}) {
  const query = { clinicId };

  if (activeOnly === true || activeOnly === 'true') {
    query.active = true;
  }
  if (category) {
    query.category = category;
  }
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [{ name: searchRegex }, { category: searchRegex }];
  }

  const services = await Service.find(query).sort({ category: 1, name: 1 });
  return services;
}

module.exports = {
  createService,
  getServiceById,
  updateService,
  archiveService,
  listServices,
};
