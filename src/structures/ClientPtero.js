const axios = require("axios");
const { ptero } = require("../../settings");

const clientApi = axios.create({
  baseURL: `${ptero.url}/api/client`,
  headers: {
    "Authorization": `Bearer ${ptero.clientApiKey}`, // new key!
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
});

module.exports = clientApi;
