/**
  
 */

module.exports = {
  createPayment: async () => ({ success: false, error: 'SonicPesa is no longer supported. Please use PalmPesa.' }),
  verifyPayment: async () => ({ success: false, error: 'SonicPesa is no longer supported. Please use PalmPesa.' }),
  validateWebhookSignature: () => true,
  getAvailablePaymentMethods: () => []
};
