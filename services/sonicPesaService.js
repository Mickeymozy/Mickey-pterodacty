/**
 * Legacy SonicPesa service file retained as a stub to avoid runtime require failures.
 * The application now uses the PalmPesa service instead.
 */

module.exports = {
  createPayment: async () => ({ success: false, error: 'SonicPesa is no longer supported. Please use PalmPesa.' }),
  verifyPayment: async () => ({ success: false, error: 'SonicPesa is no longer supported. Please use PalmPesa.' }),
  validateWebhookSignature: () => true,
  getAvailablePaymentMethods: () => []
};
