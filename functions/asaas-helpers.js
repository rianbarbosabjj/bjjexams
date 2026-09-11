const axios = require('axios');

class AsaasHelper {
  constructor(apiKey, environment = 'sandbox') {
    if (!apiKey) throw new Error('ASAAS_API_KEY não configurada.');
    this.apiKey = apiKey;
    this.baseURL = environment === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://api-sandbox.asaas.com/v3';
    this.http = axios.create({
      baseURL: this.baseURL,
      timeout: 20000,
      headers: {
        access_token: this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'BJJ-Exams/1.0'
      }
    });
  }

  async createCustomer(customerData) {
    try {
      const response = await this.http.post('/customers', {
        name: customerData.name,
        email: customerData.email,
        cpfCnpj: customerData.cpf || undefined,
        phone: customerData.phone || undefined,
        mobilePhone: customerData.phone || undefined,
        notificationDisabled: false
      });
      return { success: true, data: response.data };
    } catch (error) {
      return this._error('criar cliente', error);
    }
  }

  async findCustomerByEmail(email) {
    if (!email) return null;
    try {
      const response = await this.http.get('/customers', { params: { email } });
      return response.data?.data?.[0] || null;
    } catch (error) {
      console.error('Erro ao buscar cliente por e-mail:', error.response?.data || error.message);
      return null;
    }
  }

  async findCustomerByCpf(cpf) {
    if (!cpf) return null;
    try {
      const response = await this.http.get('/customers', { params: { cpfCnpj: cpf } });
      return response.data?.data?.[0] || null;
    } catch (error) {
      console.error('Erro ao buscar cliente por CPF:', error.response?.data || error.message);
      return null;
    }
  }

  async createPayment(paymentData) {
    try {
      const body = {
        customer: paymentData.customerId,
        billingType: paymentData.billingType || 'PIX',
        value: paymentData.value,
        dueDate: paymentData.dueDate,
        description: paymentData.description,
        externalReference: paymentData.externalReference
      };
      if (Array.isArray(paymentData.split) && paymentData.split.length) body.split = paymentData.split;
      const response = await this.http.post('/payments', body);
      return { success: true, data: response.data };
    } catch (error) {
      return this._error('criar cobrança', error);
    }
  }

  async getPixQrCode(paymentId) {
    try {
      const response = await this.http.get(`/payments/${paymentId}/pixQrCode`);
      return { success: true, data: response.data };
    } catch (error) {
      return this._error('obter QR Code Pix', error);
    }
  }

  async getPayment(paymentId) {
    try {
      const response = await this.http.get(`/payments/${paymentId}`);
      return { success: true, data: response.data };
    } catch (error) {
      return this._error('buscar cobrança', error);
    }
  }

  _error(action, error) {
    const detail = error.response?.data || error.message;
    console.error(`Erro ao ${action}:`, detail);
    return { success: false, error: detail };
  }
}

module.exports = { AsaasHelper };
