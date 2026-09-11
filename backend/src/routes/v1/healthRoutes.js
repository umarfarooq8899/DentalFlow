'use strict';

const { Router } = require('express');

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
    },
  });
});

module.exports = router;
