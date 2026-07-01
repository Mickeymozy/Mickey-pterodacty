// Mock axios and ServerPackage before requiring the module
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn()
  }))
}));

jest.mock('../models/ServerPackage', () => ({
  findById: jest.fn()
}));

// Set env vars before requiring the module
process.env.PTERODACTYL_URL = 'https://panel.test.com';
process.env.PTERODACTYL_APP_API_KEY = 'test-api-key';

const {
  buildServerEnvironment,
  sanitizeServer
} = require('../utils/serverHelper');

describe('buildServerEnvironment', () => {
  test('returns base environment with USER_UPLOAD and AUTO_UPDATE', () => {
    const result = buildServerEnvironment({});
    expect(result.USER_UPLOAD).toBe('0');
    expect(result.AUTO_UPDATE).toBe('1');
  });

  test('includes egg config environment variables', () => {
    const eggConfig = {
      id: 16,
      environment: {
        MAIN_FILE: 'index.js',
        STARTUP_CMD: 'npm start'
      }
    };
    const result = buildServerEnvironment(eggConfig);
    expect(result.MAIN_FILE).toBe('index.js');
    expect(result.STARTUP_CMD).toBe('npm start');
  });

  test('handles null eggConfig gracefully', () => {
    const result = buildServerEnvironment(null);
    expect(result.USER_UPLOAD).toBe('0');
    expect(result.AUTO_UPDATE).toBe('1');
  });

  test('sets MAIN_FILE for Node.js egg (id=16) with startupFile option', () => {
    const eggConfig = { id: 16, environment: {} };
    const result = buildServerEnvironment(eggConfig, { startupFile: 'app.js' });
    expect(result.MAIN_FILE).toBe('app.js');
  });

  test('sets PY_FILE for Python egg (id=27) with startupFile option', () => {
    const eggConfig = { id: 27, environment: {} };
    const result = buildServerEnvironment(eggConfig, { startupFile: 'app.py' });
    expect(result.PY_FILE).toBe('app.py');
  });

  test('sets SERVER_JARFILE for Java egg (id=28) with startupFile option', () => {
    const eggConfig = { id: 28, environment: {} };
    const result = buildServerEnvironment(eggConfig, { startupFile: 'custom.jar' });
    expect(result.SERVER_JARFILE).toBe('custom.jar');
    expect(result.JARFILE).toBe('custom.jar');
  });

  test('sets default MAIN_FILE for Node.js egg when not provided', () => {
    const eggConfig = { id: 16, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.MAIN_FILE).toBe('index.js');
  });

  test('sets default PY_FILE for Python egg when not provided', () => {
    const eggConfig = { id: 27, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.PY_FILE).toBe('main.py');
  });

  test('sets default SERVER_JARFILE for Java egg when not provided', () => {
    const eggConfig = { id: 28, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.SERVER_JARFILE).toBe('server.jar');
  });

  test('sets STARTUP_CMD when startupCommand option provided', () => {
    const eggConfig = { id: 16, environment: {} };
    const result = buildServerEnvironment(eggConfig, { startupCommand: 'node server.js' });
    expect(result.STARTUP_CMD).toBe('node server.js');
  });

  test('uses default STARTUP_CMD for Node.js when not provided', () => {
    const eggConfig = { id: 16, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.STARTUP_CMD).toBe('npm start');
  });

  test('uses default STARTUP_CMD for Python when not provided', () => {
    const eggConfig = { id: 27, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.STARTUP_CMD).toBe('python3 main.py');
  });

  test('uses default STARTUP_CMD for Java when not provided', () => {
    const eggConfig = { id: 28, environment: {} };
    const result = buildServerEnvironment(eggConfig);
    expect(result.STARTUP_CMD).toBe('java -jar server.jar');
  });

  test('overrides environment with options.environment', () => {
    const eggConfig = { id: 16, environment: { MAIN_FILE: 'default.js' } };
    const result = buildServerEnvironment(eggConfig, {
      environment: { CUSTOM_VAR: 'custom-value' }
    });
    expect(result.CUSTOM_VAR).toBe('custom-value');
  });

  test('all values are strings', () => {
    const eggConfig = { id: 16, environment: { NUM_VAR: 42 } };
    const result = buildServerEnvironment(eggConfig);
    Object.values(result).forEach(val => {
      expect(typeof val).toBe('string');
    });
  });

  test('filters out undefined and null values', () => {
    const eggConfig = { id: 16, environment: { NULL_VAR: null, UNDEF_VAR: undefined } };
    const result = buildServerEnvironment(eggConfig);
    expect(result.NULL_VAR).toBeUndefined();
    expect(result.UNDEF_VAR).toBeUndefined();
  });

  test('trims string values', () => {
    const eggConfig = { id: 16, environment: { SPACED: '  value  ' } };
    const result = buildServerEnvironment(eggConfig);
    expect(result.SPACED).toBe('value');
  });

  test('filters empty-after-trim strings as undefined', () => {
    const eggConfig = { id: 16, environment: { EMPTY: '   ' } };
    const result = buildServerEnvironment(eggConfig);
    expect(result.EMPTY).toBeUndefined();
  });
});

describe('sanitizeServer', () => {
  test('extracts server attributes correctly', () => {
    const server = {
      attributes: {
        id: 1,
        uuid: 'abc-123',
        identifier: 'srv-1',
        name: 'Test Server',
        status: 'running',
        user: 5,
        limits: { memory: 1024, disk: 2048, cpu: 100 }
      }
    };
    const result = sanitizeServer(server);
    expect(result.id).toBe(1);
    expect(result.uuid).toBe('abc-123');
    expect(result.identifier).toBe('srv-1');
    expect(result.name).toBe('Test Server');
    expect(result.status).toBe('running');
    expect(result.user).toBe(5);
    expect(result.limits).toEqual({ memory: 1024, disk: 2048, cpu: 100 });
  });

  test('returns empty limits when not present', () => {
    const server = {
      attributes: {
        id: 1,
        name: 'Test'
      }
    };
    const result = sanitizeServer(server);
    expect(result.limits).toEqual({});
  });

  test('handles null/undefined server gracefully', () => {
    const result = sanitizeServer(null);
    expect(result.id).toBeUndefined();
    expect(result.limits).toEqual({});
  });

  test('handles server without attributes', () => {
    const result = sanitizeServer({});
    expect(result.id).toBeUndefined();
    expect(result.limits).toEqual({});
  });
});
