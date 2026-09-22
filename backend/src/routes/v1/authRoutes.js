'use strict';

const { Router } = require('express');
const {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  meHandler,
} = require('../../controllers/authController');
const { authenticate } = require('../../middlewares/authenticate');
const { acceptInvitationHandler } = require('../../controllers/staffController');

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.post('/forgot-password', forgotPasswordHandler);
router.post('/reset-password', resetPasswordHandler);
router.post('/invitations/accept', acceptInvitationHandler);
router.get('/me', authenticate, meHandler);

module.exports = router;
