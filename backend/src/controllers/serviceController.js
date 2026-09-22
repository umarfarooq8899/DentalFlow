'use strict';

const serviceCatalogService = require('../services/serviceCatalogService');

async function createServiceHandler(req, res, next) {
  try {
    const service = await serviceCatalogService.createService(req.user.clinicId, req.body);
    res.status(201).json({
      success: true,
      data: service,
    });
  } catch (err) {
    next(err);
  }
}

async function getServiceHandler(req, res, next) {
  try {
    const service = await serviceCatalogService.getServiceById(req.user.clinicId, req.params.id);
    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (err) {
    next(err);
  }
}

async function updateServiceHandler(req, res, next) {
  try {
    const service = await serviceCatalogService.updateService(
      req.user.clinicId,
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (err) {
    next(err);
  }
}

async function archiveServiceHandler(req, res, next) {
  try {
    const service = await serviceCatalogService.archiveService(
      req.user.clinicId,
      req.params.id
    );
    res.status(200).json({
      success: true,
      data: service,
    });
  } catch (err) {
    next(err);
  }
}

async function listServicesHandler(req, res, next) {
  try {
    const services = await serviceCatalogService.listServices(
      req.user.clinicId,
      req.query
    );
    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createServiceHandler,
  getServiceHandler,
  updateServiceHandler,
  archiveServiceHandler,
  listServicesHandler,
};
