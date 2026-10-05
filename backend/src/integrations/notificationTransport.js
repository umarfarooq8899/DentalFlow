'use strict';

async function deliverNotification() {
  const error = new Error('No email or SMS delivery adapter is configured.');
  error.code = 'NOTIFICATION_TRANSPORT_NOT_CONFIGURED';
  throw error;
}

module.exports = { deliverNotification };