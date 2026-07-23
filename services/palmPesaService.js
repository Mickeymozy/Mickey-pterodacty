/**
 * PalmPesa Payment Integration Service
 * Implements validated createPayment and verifyPayment wrappers for PalmPesa API
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
    if (!phone) return '';
    const cleaned = String(phone).replace(/\D/g, '');
    if (!cleaned) return '';
    if (cleaned.startsWith('255')) return cleaned;
    if (cleaned.startsWith('07') || cleaned.startsWith('06')) return '255' + cleaned.substring(1);
    if (cleaned.startsWith('7') || cleaned.startsWith('6')) return '255' + cleaned;
    return cleaned;
  }

  normalizePhoneForInit(phone) {
    const normalized = this.formatPhoneNumber(phone);
    if (!normalized) return '';
    return normalized.startsWith('255') ? normalized.substring(3) : normalized;
  }

  isValidEmail(email) {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  isValidHttpsUrl(value) {
    if (!value) return false;
    try {
      const parsed = new URL(String(value).trim());
      return parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  maskToken(token) {
    if (!token) return '';
    if (token.length <= 8) return '***';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  buildRequestHeaders() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
  }

  buildRequestConfig() {
    return {
      headers: this.buildRequestHeaders(),
      timeout: 20000,
      validateStatus: () => true
    };
  }

  extractErrorMessage(payload, fallbackMessage = 'PalmPesa order creation failed') {
    const body = payload?.data || payload || {};
    const message = body?.message || body?.error || body?.detail || body?.error_message || body?.result || body?.status_message || fallbackMessage;
    return typeof message === 'string' ? message : fallbackMessage;
  }

  validatePaymentPayload(paymentData = {}) {
    const errors = [];
    const buyerEmail = String(paymentData.customerEmail || paymentData.buyer_email || '').trim();
    const buyerName = String(paymentData.customerName || paymentData.buyer_name || '').trim();
    const buyerPhone = this.formatPhoneNumber(paymentData.customerPhone || paymentData.buyer_phone || '');
    const amountRaw = paymentData.amount;
    const amount = Number(amountRaw);
    const orderId = String(paymentData.order_id || paymentData.reference || paymentData.transaction_id || paymentData.orderId || `ORDER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
    const webhookUrl = String(paymentData.webhookUrl || paymentData.callback_url || this.webhookUrl || '').trim();
    const userId = String(this.userId || paymentData.user_id || '').trim();
    const vendor = String(paymentData.vendor || this.vendor || '').trim();

    if (!this.apiToken) errors.push('PALMPESA_API_TOKEN is not configured');
    if (!userId) errors.push('PALMPESA_USER_ID is not configured');
    if (!vendor) errors.push('PALMPESA_VENDOR is not configured');
    if (!buyerEmail) errors.push('buyer_email/customerEmail is required');
    if (buyerEmail && !this.isValidEmail(buyerEmail)) errors.push('buyer_email/customerEmail must be a valid email address');
    if (!buyerName) errors.push('buyer_name/customerName is required');
    if (!buyerPhone) errors.push('customerPhone/buyer_phone is required');
    else if (!/^(255[0-9]{9}|0[67][0-9]{8})$/.test(buyerPhone)) errors.push('customerPhone/buyer_phone must be a Tanzanian number like 255612130873 or 0612130873');
    if (!Number.isInteger(amount) || amount < 1) errors.push('amount must be a positive integer');
    if (!orderId) errors.push('order_id/reference/transaction_id is required');
    if (!this.isValidHttpsUrl(webhookUrl)) errors.push('webhook/callback_url must be a valid HTTPS URL');

    return {
      isValid: errors.length === 0,
      errors,
      normalized: {
        buyerEmail,
        buyerName,
        buyerPhone,
        amount,
        orderId,
        webhookUrl,
        vendor,
        userId
      }
    };
  }

  async createPayment(paymentData = {}) {
    try {
      const validation = this.validatePaymentPayload(paymentData);
      if (!validation.isValid) {
        return {
          success: false,
          error: 'PalmPesa request validation failed',
          details: {
            validationErrors: validation.errors,
            normalized: validation.normalized,
            env: {
              hasApiToken: Boolean(this.apiToken),
              hasUserId: Boolean(this.userId),
              hasVendor: Boolean(this.vendor)
            }
          }
        };
      }

      const buyerEmail = validation.normalized.buyerEmail;
      const buyerName = validation.normalized.buyerName;
      const buyerPhone = validation.normalized.buyerPhone;
      const amount = validation.normalized.amount;
      const orderId = validation.normalized.orderId;
      const webhookUrl = validation.normalized.webhookUrl;

      const payload = {
        user_id: Number(validation.normalized.userId),
        vendor: validation.normalized.vendor,
        order_id: orderId,
        buyer_email: buyerEmail,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        amount,
        currency: 'TZS',
        redirect_url: paymentData.redirectUrl || this.redirectUrl,
        cancel_url: paymentData.cancelUrl || this.cancelUrl,
        webhook: webhookUrl,
        buyer_remarks: paymentData.buyer_remarks || 'Purchase',
        merchant_remarks: paymentData.merchant_remarks || paymentData.description || 'Transaction',
        no_of_items: paymentData.no_of_items || 1
      };

      const directMobileBody = {
        name: buyerName,
        email: buyerEmail,
        phone: this.normalizePhoneForInit(buyerPhone),
        amount,
        transaction_id: orderId,
        address: paymentData.address || 'Dar es Salaam',
        postcode: paymentData.postcode || '00000',
        callback_url: webhookUrl.replace('http://', 'https://')
      };

      const fallbackPayloads = [
        {
          name: 'mobile-initiate',
          url: `${this.baseUrl}/api/palmpesa/initiate`,
          body: directMobileBody
        },
        {
          name: 'pay-via-mobile',
          url: `${this.baseUrl}/api/pay-via-mobile`,
          body: {
            user_id: validation.normalized.userId,
            name: buyerName,
            email: buyerEmail,
            phone: this.normalizePhoneForInit(buyerPhone),
            amount,
            transaction_id: orderId,
            address: paymentData.address || 'Dar es Salaam',
            postcode: paymentData.postcode || '00000',
            buyer_uuid: Date.now()
          }
        },
        {
          name: 'pay-by-link',
          url: `${this.baseUrl}/api/process-payment`,
          body: payload
        }
      ];

      let lastError = null;
      let lastDetails = null;

      for (const candidate of fallbackPayloads) {
        console.log('[PalmPesa] request', {
          endpoint: candidate.name,
          url: candidate.url,
          payload: candidate.body,
          headers: {
            Authorization: `Bearer ${this.maskToken(this.apiToken)}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        });

        try {
          const response = await axios.post(candidate.url, candidate.body, this.buildRequestConfig());
          const data = response.data || {};

          console.log('[PalmPesa] raw response', {
            endpoint: candidate.name,
            status: response.status,
            statusText: response.statusText,
            body: data,
            headers: response.headers
          });

          const paymentUrl = data?.raw?.payment_gateway_url || data?.raw?.payment_url || data?.payment_gateway_url || data?.payment_url || data?.paymentUrl || data?.payment_url || null;
          const rawLinkSuccess = Boolean(paymentUrl);
          const sharableOk = data?.error === 'sharable payment link' || data?.message === 'sharable payment link';
          const initiated = Boolean(data?.order_id || data?.message?.toLowerCase?.().includes('initiated') || data?.response?.resultcode === '000' || data?.response?.resultcode === 'SUCCESS');
          const mobilePromptSuccess = Boolean(data?.message?.toLowerCase?.().includes('payment initiated') || data?.message?.toLowerCase?.().includes('payment request sent') || data?.order_id);

          if (rawLinkSuccess || sharableOk || (response.status >= 200 && response.status < 300 && (initiated || mobilePromptSuccess))) {
            return {
              success: true,
              paymentUrl,
              orderId: data?.raw?.order_id || data?.order_id || data?.response?.order_id || data?.orderId || orderId,
              transactionId: data?.raw?.transid || data?.transaction_id || data?.response?.transid || orderId,
              reference: orderId,
              raw: data,
              endpoint: candidate.name,
              details: {
                status: response.status,
                statusText: response.statusText,
                body: data
              }
            };
          }

          lastError = this.extractErrorMessage(data, 'PalmPesa order creation failed');
          lastDetails = {
            status: response.status,
            statusText: response.statusText,
            body: data,
            endpoint: candidate.name
          };

          console.error('[PalmPesa] provider rejected request', lastDetails);
        } catch (axiosError) {
          const responseData = axiosError?.response?.data || {};
          lastError = this.extractErrorMessage(responseData, axiosError.message || 'PalmPesa request failed');
          lastDetails = {
            status: axiosError?.response?.status,
            statusText: axiosError?.response?.statusText,
            body: responseData,
            endpoint: candidate.name,
            requestUrl: axiosError?.config?.url,
            message: axiosError.message
          };
          console.error('[PalmPesa] request failed', lastDetails);
        }
      }

      return {
        success: false,
        error: lastError || 'PalmPesa order creation failed',
        details: lastDetails || null
      };
    } catch (error) {
      const errorResponse = error?.response?.data || {};
      const errorMessage = this.extractErrorMessage(errorResponse, error.message || 'PalmPesa payment creation failed');
      const errorDetails = {
        message: errorMessage,
        status: error?.response?.status,
        body: errorResponse,
        url: error?.config?.url,
        type: 'network_error'
      };
      console.error('[PalmPesa] unexpected error', errorDetails);
      return { success: false, error: errorMessage, details: errorDetails };
    }
  }

  async verifyPayment(orderId) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/order-status`, { order_id: orderId }, this.buildRequestConfig());
      const data = response.data || {};

      console.log('[PalmPesa] verification response', {
        status: response.status,
        statusText: response.statusText,
        body: data
      });

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

      return {
        success: false,
        error: this.extractErrorMessage(data, 'Failed to fetch order status'),
        details: {
          status: response.status,
          statusText: response.statusText,
          body: data
        }
      };
    } catch (error) {
      const responseData = error?.response?.data || {};
      console.error('[PalmPesa] verification failed', {
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        body: responseData,
        message: error.message
      });
      return {
        success: false,
        error: this.extractErrorMessage(responseData, error.message || 'Payment verification failed'),
        details: {
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          body: responseData,
          message: error.message
        }
      };
    }
  }

  validateWebhookSignature() {
    return true;
  }

  getAvailablePaymentMethods() {
    return [
      { id: 'palmpesa', name: 'PalmPesa - Mobile & Pay-by-link', icon: 'mobile' }
    ];
  }
}

module.exports = new PalmPesaService();
