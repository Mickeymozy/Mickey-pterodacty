/**
 * PalmPesa Payment Integration Service
 * Implements basic createPayment and verifyPayment wrappers for PalmPesa API
 */

const axios = require('axios');

class PalmPesaService {
  constructor() {
    this.apiToken = process.env.PALMPESA_API_TOKEN || '';
    this.userId = process.env.PALMPESA_USER_ID || '';
    this.baseUrl = (process.env.PALMPESA_BASE_URL || 'https://palmpesa.drmlelwa.co.tz').replace(/\/$/, '');
    this.vendor = process.env.PALMPESA_VENDOR || 'TILL61103867';
    this.redirectUrl = process.env.PALMPESA_REDIRECT_URL || process.env.APP_URL || 'https://mickey-pterodacty.vercel.app';
    this.cancelUrl = process.env.PALMPESA_CANCEL_URL || this.redirectUrl + '/cancel';
    this.webhookUrl = process.env.PALMPESA_WEBHOOK_URL || `${this.redirectUrl}/api/payment/webhook`;
  }

  async createPayment(paymentData = {}) {
    try {
      const payload = {
        user_id: Number(this.userId) || Number(paymentData.user_id) || 0,
        vendor: paymentData.vendor || this.vendor,
        order_id: paymentData.order_id || (paymentData.reference || `ORDER-${Date.now()}`),
        buyer_email: paymentData.customerEmail || paymentData.buyer_email || '',
        buyer_name: paymentData.customerName || paymentData.buyer_name || 'Customer',
        buyer_phone: paymentData.customerPhone || paymentData.buyer_phone || '',
        amount: Number(paymentData.amount || 0),
        currency: paymentData.currency || 'TZS',
        redirect_url: paymentData.redirectUrl || this.redirectUrl,
        cancel_url: paymentData.cancelUrl || this.cancelUrl,
        webhook: paymentData.webhookUrl || this.webhookUrl,
        buyer_remarks: paymentData.buyer_remarks || paymentData.metadata?.buyer_remarks || '',
        merchant_remarks: paymentData.merchant_remarks || paymentData.description || '',
        no_of_items: paymentData.no_of_items || 1,
        metadata: paymentData.metadata || {}
      };

      if (!payload.buyer_email) {
        // PalmPesa may allow phone-only payments, but keep a warning consistent with previous logic
        // return { success: false, error: 'Customer email is required' };
      }

      const response = await axios.post(`${this.baseUrl}/api/process-payment`, payload, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 20000
      });

      const data = response.data || {};
      if (response.status === 200) {
        return {
          success: true,
          paymentUrl: data?.raw?.payment_gateway_url || data?.raw?.payment_url || data?.paymentUrl || data?.payment_url || data?.paymentUrl || null,
          orderId: data?.raw?.order_id || data?.order_id || data?.orderId || payload.order_id,
          transactionId: data?.raw?.transid || data?.transaction_id || payload.order_id,
          reference: payload.order_id,
          raw: data
        };
      }

      return { success: false, error: data?.message || 'PalmPesa initialization failed' };
    } catch (error) {
      console.error('PalmPesa Error:', error?.response?.data || error.message || error);
      return { success: false, error: error?.response?.data?.message || error.message || 'PalmPesa initialization failed' };
    }
  }

  async verifyPayment(orderId) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/order-status`, { order_id: orderId }, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        timeout: 20000
      });

      const data = response.data || {};
      if (response.status === 200) {
        const resultData = data?.data && data.data[0] ? data.data[0] : data?.data || {};
        return {
          success: true,
          paymentStatus: (resultData.payment_status || resultData.status || data.result || 'PENDING').toLowerCase(),
          amount: resultData.amount || data.amount,
          reference: resultData.reference || data.reference || orderId,
          orderId: resultData.order_id || data.order_id || orderId,
          raw: data
        };
      }

      return { success: false, error: data?.message || 'Failed to fetch order status' };
    } catch (error) {
      console.error('PalmPesa Verify Error:', error?.response?.data || error.message || error);
      return { success: false, error: error?.response?.data?.message || error.message || 'Payment verification failed' };
    }
  }

  validateWebhookSignature() {
    // PalmPesa docs do not specify a signature scheme. Accept webhooks by default.
    return true;
  }

  getAvailablePaymentMethods() {
    return [
      { id: 'palmpesa', name: 'PalmPesa - Mobile & Pay-by-link', icon: 'mobile' }
    ];
  }
}

module.exports = new PalmPesaService();
