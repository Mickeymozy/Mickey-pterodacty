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

  formatPhoneNumber(phone) {
    // Convert phone to Tanzania format without + sign
    if (!phone) return '';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('255')) {
      return cleaned; // 255744000000
    }
    if (cleaned.startsWith('07') || cleaned.startsWith('06')) {
      return '255' + cleaned.substring(1); // 07... or 06... → 255...
    }
    if (cleaned.startsWith('7') || cleaned.startsWith('6')) {
      return '255' + cleaned; // 7... or 6... → 2557... or 2556...
    }
    return cleaned;
  }

  async createPayment(paymentData = {}) {
    try {
      // Validate required fields
      const buyerEmail = paymentData.customerEmail || paymentData.buyer_email || '';
      const buyerName = paymentData.customerName || paymentData.buyer_name || 'Customer';
      const buyerPhone = this.formatPhoneNumber(paymentData.customerPhone || paymentData.buyer_phone || '');
      const amount = Number(paymentData.amount || 0);
      const orderId = paymentData.order_id || (paymentData.reference || `ORDER-${Date.now()}`);

      if (!buyerEmail) {
        return { success: false, error: 'Buyer email is required' };
      }
      if (!buyerName) {
        return { success: false, error: 'Buyer name is required' };
      }
      if (!buyerPhone) {
        return { success: false, error: 'Buyer phone (TZ format: 255...) is required' };
      }
      if (!amount || amount < 1) {
        return { success: false, error: 'Valid amount (min 1 TZS) is required' };
      }

      const payload = {
        user_id: Number(this.userId),
        vendor: paymentData.vendor || this.vendor,
        order_id: orderId,
        buyer_email: buyerEmail,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        amount: amount,
        currency: 'TZS',
        redirect_url: paymentData.redirectUrl || this.redirectUrl,
        cancel_url: paymentData.cancelUrl || this.cancelUrl,
        webhook: paymentData.webhookUrl || this.webhookUrl,
        buyer_remarks: paymentData.buyer_remarks || 'Purchase',
        merchant_remarks: paymentData.merchant_remarks || paymentData.description || 'Transaction',
        no_of_items: paymentData.no_of_items || 1
      };

      console.log('PalmPesa /api/process-payment request:', { 
        url: `${this.baseUrl}/api/process-payment`,
        credentials: {
          user_id: payload.user_id,
          vendor: payload.vendor,
          hasApiToken: !!this.apiToken
        },
        payload: {
          ...payload,
          buyer_phone: buyerPhone // Show formatted phone
        }
      });

      let response;
      try {
        response = await axios.post(`${this.baseUrl}/api/process-payment`, payload, {
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          timeout: 20000,
          validateStatus: () => true // Accept all status codes
        });
      } catch (axiosError) {
        console.error('Axios request failed:', axiosError.message);
        return { success: false, error: axiosError.message };
      }

      const data = response.data || {};
      console.log('PalmPesa response:', { status: response.status, statusText: response.statusText, data });
      
      // PalmPesa returns 200 with "error": "sharable payment link" on success
      if (response.status === 200 && (data?.raw?.payment_gateway_url || data?.error === 'sharable payment link')) {
        return {
          success: true,
          paymentUrl: data?.raw?.payment_gateway_url || null,
          orderId: data?.raw?.order_id || orderId,
          transactionId: data?.raw?.transid || orderId,
          reference: orderId,
          raw: data
        };
      }

      // Handle error response from PalmPesa
      const errorMsg = data?.message || data?.result || data?.error || data?.error_message || 'PalmPesa order creation failed';
      console.error('PalmPesa error response:', { 
        status: response.status, 
        statusText: response.statusText, 
        message: errorMsg, 
        fullData: data,
        allKeys: Object.keys(data)
      });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorResponse = error?.response?.data || {};
      const errorMessage = errorResponse.message || errorResponse.error || error.message || 'PalmPesa payment creation failed';
      const errorDetails = {
        message: errorMessage,
        status: error?.response?.status,
        data: errorResponse,
        url: error?.config?.url,
        type: 'network_error'
      };
      console.error('PalmPesa Error:', errorDetails);
      return { success: false, error: errorMessage };
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
