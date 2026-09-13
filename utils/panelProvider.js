const axios = require('axios');

class PterodactylProvider {
  constructor() {
    const baseUrl = String(process.env.PANEL_URL || process.env.PTERODACTYL_URL || '').replace(/\/$/, '');
    const apiKey = process.env.PANEL_API_KEY || process.env.PTERODACTYL_APP_API_KEY || '';
    if (!baseUrl || !apiKey) throw new Error('Panel URL and API key are required.');
    this.client = axios.create({
      baseURL: `${baseUrl}/api/application`,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000
    });
  }

  async createUser(payload) {
    const response = await this.client.post('/users', payload);
    return response.data?.attributes || response.data;
  }

  async createServer(payload) {
    const response = await this.client.post('/servers', payload);
    return response.data?.attributes || response.data;
  }

  async deleteServer(id) {
    await this.client.delete(`/servers/${encodeURIComponent(id)}`);
  }

  async suspendServer(id) {
    await this.client.post(`/servers/${encodeURIComponent(id)}/suspend`);
  }

  async getServerResources(identifier) {
    const clientKey = process.env.PTERODACTYL_CLIENT_API_KEY || process.env.PTERODACTYL_CLIENT_KEY;
    const baseUrl = String(process.env.PANEL_URL || process.env.PTERODACTYL_URL || '').replace(/\/$/, '');
    if (!clientKey || !baseUrl) throw new Error('Panel client API key is required for resources.');
    const response = await axios.get(`${baseUrl}/api/client/servers/${encodeURIComponent(identifier)}/resources`, {
      headers: { Authorization: `Bearer ${clientKey}`, Accept: 'application/json' },
      timeout: 10000
    });
    return response.data?.attributes || {};
  }
}

function getPanelProvider() {
  const provider = String(process.env.PANEL_PROVIDER || 'pterodactyl').toLowerCase();
  if (provider === 'pterodactyl') return new PterodactylProvider();
  throw new Error(`Unsupported panel provider: ${provider}`);
}

module.exports = { getPanelProvider, PterodactylProvider };
