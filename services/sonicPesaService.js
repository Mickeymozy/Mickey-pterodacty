/**
 * SonicPesa Payment Integration Service
 */

const axios = require('axios');
const crypto = require('crypto');

class SonicPesaService {
  constructor() {
    this.apiKey = process.env.SONICPESA_API_KEY || '';
    this.baseUrl = (process.env.SONICPESA_BASE_URL || 'https://api.sonicpesa.com/api/v1').replace(/\/$/, '');
    this.webhookSecret = process.env.SONICPESA_WEBHOOK_SECRET || '';
    this.redirectUrl = process.env.SONICPESA_REDIRECT_URL || process.env.APP_URL || 'http://localhost:3000';
    this.webhookUrl = process.env.SONICPESA_WEBHOOK_URL || `${this.redirectUrl}/api/payment/webhook`;
  }

  async createPayment(paymentData = {}) {
    try {
      const payload = {
        buyer_email: paymentData.customerEmail || paymentData.buyerEmail || '',
        buyer_name: paymentData.customerName || paymentData.buyerName || 'Customer',
        buyer_phone: paymentData.customerPhone || paymentData.buyerPhone || '',
        amount: Number(paymentData.amount || 0),
        currency: paymentData.currency || 'TZS',
        reference: paymentData.reference || this.generateReference(),
        redirect_url: paymentData.redirectUrl || this.redirectUrl,
        callback_url: paymentData.webhookUrl || this.webhookUrl,
        metadata: paymentData.metadata || {}
      };

      if (!payload.buyer_email) {
        return {
          success: false,
          error: 'Customer email is required for SonicPesa payment.'
        };
      }

      const response = await axios.post(`${this.baseUrl}/payment/create_order`, payload, {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });

      const data = response.data?.data || {};
      const isSuccess = response.data?.status === 'success' || response.data?.success;

      if (isSuccess) {
        return {
          success: true,
          paymentUrl: data.payment_url || data.paymentUrl || data.link || payload.redirect_url,
          transactionId: data.order_id || data.orderId || data.transid || payload.reference,
          orderId: data.order_id || data.orderId || null,
          reference: data.reference || payload.reference,
          raw: response.data
        };
      }

      return {
        success: false,
        error: response.data?.message || 'SonicPesa payment initialization failed.'
      };
    } catch (error) {
      console.error('SonicPesa Error:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'SonicPesa payment initialization failed.'
      };
    }
  }

  async verifyPayment(orderId) {
    try {
      const response = await axios.post(`${this.baseUrl}/payment/order_status`, { order_id: orderId }, {
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });

      const data = response.data?.data || {};
      if (response.data?.status === 'success' || response.data?.success) {
        return {
          success: true,
          paymentStatus: data.payment_status || data.status || 'PENDING',
          amount: data.amount,
          reference: data.reference,
          orderId: data.order_id || orderId,
          raw: response.data
        };
      }

      return {
        success: false,
        error: response.data?.message || 'Payment verification failed.'
      };
    } catch (error) {
      console.error('SonicPesa Verification Error:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Payment verification failed.'
      };
    }
  }

  validateWebhookSignature(payload, signature) {
    if (!this.webhookSecret || !signature) return true;

    const calculated = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(signature));
  }

  generateReference() {
    return `SP_${Date.now()}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  }

  getAvailablePaymentMethods() {
    return [
      {
        id: 'sonicpesa',
        name: 'SonicPesa USSD / Mobile Payment',
        icon: 'mobile'
      }
    ];
  }
}

module.exports = new SonicPesaService();
