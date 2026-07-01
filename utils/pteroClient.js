const axios = require('axios');

const PTERODACTYL_URL = process.env.PTERODACTYL_URL?.replace(/\/$/, '');
const PTERODACTYL_APP_API_KEY = process.env.PTERODACTYL_APP_API_KEY;
const PTERODACTYL_CLIENT_API_KEY = process.env.PTERODACTYL_CLIENT_API_KEY || process.env.PTERODACTYL_CLIENT_KEY || process.env.PTERODACTYL_API_KEY || process.env.PTERODACTYL_APP_API_KEY;
const hasPteroConfig = Boolean(PTERODACTYL_URL && PTERODACTYL_APP_API_KEY);
const hasClientConfig = Boolean(PTERODACTYL_URL && PTERODACTYL_CLIENT_API_KEY);

const isClientApiKey = (key) => typeof key === 'string' && key.startsWith('ptlc_');
const clientApiUsable = Boolean(hasClientConfig && isClientApiKey(PTERODACTYL_CLIENT_API_KEY));
const CLIENT_KEY_REQUIRED_MESSAGE = 'Kipengele hiki kinahitaji Pterodactyl CLIENT API key (inayoanza na "ptlc_"). Weka PTERODACTYL_CLIENT_API_KEY kwenye mipangilio ya server (.env).';

const DEFAULT_SERVER_PASSWORD = process.env.DEFAULT_SERVER_PASSWORD || process.env.SERVER_DEFAULT_PASSWORD || 'MICKEY24@';

const appApi = hasPteroConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/application`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_APP_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000
    })
  : null;

const clientApi = hasClientConfig
  ? axios.create({
      baseURL: `${PTERODACTYL_URL}/api/client`,
      headers: {
        Authorization: `Bearer ${PTERODACTYL_CLIENT_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 10000
    })
  : null;

const eggConfigs = {
  16: {
    id: 16,
    key: 'nodejs',
    name: 'Node.js',
    docker_image: 'ghcr.io/parkervcp/yolks:nodejs_21',
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$NODE_PACKAGES" ]]; then /usr/local/bin/npm install $NODE_PACKAGES; fi; if [[ ! -z "$UNNODE_PACKAGES" ]]; then /usr/local/bin/npm uninstall $UNNODE_PACKAGES; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ "$MAIN_FILE" == "*.js" ]]; then /usr/local/bin/node "/home/container/$MAIN_FILE" $NODE_ARGS; else /usr/local/bin/ts-node --esm "/home/container/$MAIN_FILE" $NODE_ARGS; fi`,
    environment: {
      USER_UPLOAD: '0',
      MAIN_FILE: 'index.js',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'npm start'
    }
  },
  27: {
    id: 27,
    key: 'python',
    name: 'Python',
    docker_image: 'ghcr.io/parkervcp/yolks:python_3.10',
    startup: `if [[ -d .git ]] && [[ "$AUTO_UPDATE" == "1" ]]; then git pull; fi; if [[ ! -z "$PY_PACKAGES" ]]; then pip install -U --prefix .local $PY_PACKAGES; fi; if [[ -f /home/container/$REQUIREMENTS_FILE ]]; then pip install -U --prefix .local -r $REQUIREMENTS_FILE; fi; /usr/local/bin/python /home/container/$PY_FILE`,
    environment: {
      USER_UPLOAD: '0',
      PY_FILE: 'main.py',
      REQUIREMENTS_FILE: 'requirements.txt',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'python3 main.py'
    }
  },
  28: {
    id: 28,
    key: 'java',
    name: 'Java',
    docker_image: 'ghcr.io/parkervcp/yolks:java_17',
    startup: 'java -Dterminal.jline=false -Dterminal.ansi=true -jar $SERVER_JARFILE',
    environment: {
      USER_UPLOAD: '0',
      SERVER_JARFILE: 'server.jar',
      AUTO_UPDATE: '1',
      STARTUP_CMD: 'java -jar server.jar'
    }
  }
};

const EGG_ALIAS_MAP = {
  nodejs: '16',
  node: '16',
  python: '27',
  java: '28'
};

const normalizeServerStatus = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || ['unknown', 'null', 'none'].includes(raw)) return 'unknown';
  if (['running', 'online', 'active', 'started'].includes(raw)) return 'online';
  if (['starting', 'booting', 'launching', 'restarting'].includes(raw)) return 'starting';
  if (['installing', 'creating', 'building', 'setting up'].includes(raw)) return 'installing';
  if (['offline', 'stopped', 'stopping', 'suspended', 'disabled', 'crashed', 'dead', 'failed'].includes(raw)) return 'offline';
  return raw;
};

module.exports = {
  PTERODACTYL_URL,
  appApi,
  clientApi,
  hasPteroConfig,
  hasClientConfig,
  isClientApiKey,
  clientApiUsable,
  CLIENT_KEY_REQUIRED_MESSAGE,
  DEFAULT_SERVER_PASSWORD,
  eggConfigs,
  EGG_ALIAS_MAP,
  normalizeServerStatus
};
