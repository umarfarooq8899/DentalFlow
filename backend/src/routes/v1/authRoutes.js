'use strict';

const { Router } = require('express');
const {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
} = require('../../controllers/authController');
const { authenticate } = require('../../middlewares/authenticate');

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', authenticate, meHandler);

module.exports = router;
