const { validateRegistration, getPasswordRequirements } = require('../middleware/registrationValidator');

describe('validateRegistration', () => {
  let req, res, next;

  beforeEach(() => {
    req = { body: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('returns 400 when all fields are missing', () => {
    req.body = {};
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'All fields are required'
    });
  });

  test('returns 400 when username is missing', () => {
    req.body = { email: 'test@test.com', password: 'Pass1!aa', confirmPassword: 'Pass1!aa' };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'All fields are required'
    }));
  });

  test('returns 400 when username is too short', () => {
    req.body = {
      username: 'ab',
      email: 'test@test.com',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Username must be between 3 and 30 characters'
    }));
  });

  test('returns 400 when username is too long', () => {
    req.body = {
      username: 'a'.repeat(31),
      email: 'test@test.com',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Username must be between 3 and 30 characters'
    }));
  });

  test('returns 400 for invalid email format', () => {
    req.body = {
      username: 'validuser',
      email: 'not-an-email',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Invalid email format'
    }));
  });

  test('returns 400 when passwords do not match', () => {
    req.body = {
      username: 'validuser',
      email: 'test@test.com',
      password: 'StrongP@ss1',
      confirmPassword: 'DifferentP@ss2'
    };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Passwords do not match'
    }));
  });

  test('returns 400 when password fails complexity requirements', () => {
    req.body = {
      username: 'validuser',
      email: 'test@test.com',
      password: 'weakpass',
      confirmPassword: 'weakpass'
    };
    validateRegistration(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Password does not meet complexity requirements'
    }));
    expect(res.json.mock.calls[0][0].errors).toBeDefined();
    expect(res.json.mock.calls[0][0].strength).toBeDefined();
  });

  test('calls next() with valid registration data', () => {
    req.body = {
      username: 'validuser',
      email: 'Test@Example.com',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.validatedData).toBeDefined();
    expect(req.validatedData.username).toBe('validuser');
    expect(req.validatedData.email).toBe('test@example.com');
    expect(req.validatedData.password).toBe('StrongP@ss1');
    expect(req.validatedData.passwordStrength).toBeGreaterThan(0);
  });

  test('lowercases email in validated data', () => {
    req.body = {
      username: 'validuser',
      email: 'User@DOMAIN.COM',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(req.validatedData.email).toBe('user@domain.com');
  });

  test('accepts minimum valid username (3 chars)', () => {
    req.body = {
      username: 'abc',
      email: 'test@test.com',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('accepts maximum valid username (30 chars)', () => {
    req.body = {
      username: 'a'.repeat(30),
      email: 'test@test.com',
      password: 'StrongP@ss1',
      confirmPassword: 'StrongP@ss1'
    };
    validateRegistration(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('getPasswordRequirements', () => {
  let req, res;

  beforeEach(() => {
    req = {};
    res = {
      json: jest.fn()
    };
  });

  test('returns success with requirements array', () => {
    getPasswordRequirements(req, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      requirements: expect.any(Array)
    });
  });

  test('returns 5 password requirements', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements).toHaveLength(5);
  });

  test('each requirement has rule and code fields', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    response.requirements.forEach(req => {
      expect(req).toHaveProperty('rule');
      expect(req).toHaveProperty('code');
      expect(typeof req.rule).toBe('string');
      expect(typeof req.code).toBe('string');
    });
  });

  test('includes LENGTH requirement', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements.find(r => r.code === 'LENGTH')).toBeDefined();
  });

  test('includes UPPERCASE requirement', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements.find(r => r.code === 'UPPERCASE')).toBeDefined();
  });

  test('includes LOWERCASE requirement', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements.find(r => r.code === 'LOWERCASE')).toBeDefined();
  });

  test('includes NUMERIC requirement', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements.find(r => r.code === 'NUMERIC')).toBeDefined();
  });

  test('includes SPECIAL requirement', () => {
    getPasswordRequirements(req, res);
    const response = res.json.mock.calls[0][0];
    expect(response.requirements.find(r => r.code === 'SPECIAL')).toBeDefined();
  });
});
