/**
 * ZenoPay Payment Integration Service
 */

const axios = require('axios');
const crypto = require('crypto');

class ZenoPayService {
  constructor() {
    this.apiKey = process.env.ZENOPAY_API_KEY || '';
    this.baseUrl = process.env.ZENOPAY_API_URL || 'https://api.zenopay.io';
    this.merchantId = process.env.ZENOPAY_MERCHANT_ID || '';
    this.webhookSecret = process.env.ZENOPAY_WEBHOOK_SECRET || '';
    this.returnUrl = process.env.APP_URL || 'http://localhost:3000';
  }

  async createPayment(paymentData) {
    try {
      const payload = {
        merchant_id: this.merchantId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'USD',
        reference: paymentData.reference || this.generateReference(),
        description: paymentData.description,
        customer_email: paymentData.customerEmail,
        customer_name: paymentData.customerName,
        metadata: paymentData.metadata || {},
        return_url: `${this.returnUrl}/payment/callback`,
        webhook_url: `${this.returnUrl}/api/payment/webhook`,
        timestamp: Date.now(),
        payment_methods: ['card', 'mobile_money', 'bank_transfer']
      };

      payload.signature = this.generateSignature(payload);

      const response = await axios.post(
        `${this.baseUrl}/v1/payments/initialize`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.status === 'success') {
        return {
          success: true,
          paymentUrl: response.data.data.payment_url,
          transactionId: response.data.data.transaction_id,
          reference: response.data.data.reference
        };
      } else {
        return {
          success: false,
          error: response.data.message || 'Payment initialization failed'
        };
      }
    } catch (error) {
      console.error('ZenoPay Error:', error.message);
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  async verifyPayment(transactionId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/payments/${transactionId}/verify`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data.status === 'success') {
        return {
          success: true,
          paymentStatus: response.data.data.status,
          amount: response.data.data.amount,
          reference: response.data.data.reference,
          customerEmail: response.data.data.customer_email
        };
      } else {
        return {
          success: false,
          error: 'Payment verification failed'
        };
      }
    } catch (error) {
      console.error('ZenoPay Verification Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async refundPayment(transactionId, amount = null) {
    try {
      const payload = {
        merchant_id: this.merchantId,
        amount: amount,
        reason: 'Customer request',
        timestamp: Date.now()
      };

      payload.signature = this.generateSignature(payload);

      const response = await axios.post(
        `${this.baseUrl}/v1/payments/${transactionId}/refund`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: response.data.status === 'success',
        refundId: response.data.data?.refund_id,
        message: response.data.message
      };
    } catch (error) {
      console.error('ZenoPay Refund Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateWebhookSignature(payload, signature) {
    const calculated = this.generateSignature(payload);
    return crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(signature)
    );
  }

  generateReference() {
    return `TXN_${Date.now()}_${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  generateSignature(payload) {
    const sorted = Object.keys(payload)
      .sort()
      .reduce((acc, key) => {
        if (payload[key] !== null && payload[key] !== undefined) {
          acc += `${key}=${JSON.stringify(payload[key])}`;
        }
        return acc;
      }, '');

    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(sorted)
      .digest('hex');
  }

  getAvailablePaymentMethods() {
    return [
      {
        id: 'card',
        name: 'Credit/Debit Card',
        icon: 'credit-card'
      },
      {
        id: 'mobile_money',
        name: 'Mobile Money',
        icon: 'mobile'
      },
      {
        id: 'bank_transfer',
        name: 'Bank Transfer',
        icon: 'bank'
      }
    ];
  }

  coinsToUSD(coins) {
    const coinValue = parseFloat(process.env.COIN_VALUE_USD || '0.01');
    return coins * coinValue;
  }

  usdToCoins(usd) {
    const coinValue = parseFloat(process.env.COIN_VALUE_USD || '0.01');
    return Math.floor(usd / coinValue);
  }
}

module.exports = new ZenoPayService();
