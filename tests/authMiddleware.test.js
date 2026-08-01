const { isAdminUser, requireAuth, requireGuest, requireAdmin, ADMIN_EMAILS } = require('../middleware/auth');

// Mock the User model
jest.mock('../models/User', () => ({
  findById: jest.fn()
}));

const User = require('../models/User');

describe('isAdminUser', () => {
  test('returns false for null user', () => {
    expect(isAdminUser(null)).toBe(false);
  });

  test('returns false for undefined user', () => {
    expect(isAdminUser(undefined)).toBe(false);
  });

  test('returns true for user with role "admin"', () => {
    expect(isAdminUser({ role: 'admin', email: 'other@test.com' })).toBe(true);
  });

  test('returns true for user with isAdmin flag', () => {
    expect(isAdminUser({ isAdmin: true, email: 'other@test.com' })).toBe(true);
  });

  test('returns true for user with admin email', () => {
    expect(isAdminUser({ email: 'mickidadyhamza@gmail.com', role: 'user' })).toBe(true);
  });

  test('is case-insensitive for admin email check', () => {
    expect(isAdminUser({ email: 'MICKIDADYHAMZA@GMAIL.COM', role: 'user' })).toBe(true);
  });

  test('returns false for regular user', () => {
    expect(isAdminUser({ email: 'regular@test.com', role: 'user', isAdmin: false })).toBe(false);
  });

  test('handles user with empty email', () => {
    expect(isAdminUser({ email: '', role: 'user' })).toBe(false);
  });

  test('handles user without email property', () => {
    expect(isAdminUser({ role: 'user' })).toBe(false);
  });
});

describe('ADMIN_EMAILS', () => {
  test('contains the default admin email', () => {
    expect(ADMIN_EMAILS).toContain('mickidadyhamza@gmail.com');
  });

  test('emails are lowercase and trimmed', () => {
    ADMIN_EMAILS.forEach(email => {
      expect(email).toBe(email.toLowerCase().trim());
    });
  });
});

describe('requireAuth middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn(),
      flash: jest.fn(),
      originalUrl: '/dashboard',
      headers: {},
      xhr: false
    };
    res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('calls next() when user is authenticated', () => {
    req.isAuthenticated.mockReturnValue(true);
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('redirects to login when user is not authenticated (non-API)', () => {
    req.isAuthenticated.mockReturnValue(false);
    requireAuth(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/login.html');
  });

  test('returns 401 JSON for unauthenticated API requests', () => {
    req.isAuthenticated.mockReturnValue(false);
    req.originalUrl = '/api/user/profile';
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Authentication required'
    });
  });

  test('returns 401 for XHR requests', () => {
    req.isAuthenticated.mockReturnValue(false);
    req.xhr = true;
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('sets flash message on redirect', () => {
    req.isAuthenticated.mockReturnValue(false);
    requireAuth(req, res, next);
    expect(req.flash).toHaveBeenCalledWith('error_msg', expect.any(String));
  });
});

describe('requireGuest middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn()
    };
    res = {
      redirect: jest.fn()
    };
    next = jest.fn();
  });

  test('calls next() when user is NOT authenticated', () => {
    req.isAuthenticated.mockReturnValue(false);
    requireGuest(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('redirects to dashboard when user IS authenticated', () => {
    req.isAuthenticated.mockReturnValue(true);
    requireGuest(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/dashboard.html');
  });
});

describe('requireAdmin middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      isAuthenticated: jest.fn(),
      user: { _id: 'user123' },
      flash: jest.fn(),
      originalUrl: '/admin',
      headers: {},
      xhr: false
    };
    res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('calls next() for authenticated admin user', async () => {
    req.isAuthenticated.mockReturnValue(true);
    const mockUser = {
      _id: 'user123',
      email: 'mickidadyhamza@gmail.com',
      role: 'admin',
      isAdmin: true,
      isModified: jest.fn().mockReturnValue(false),
      save: jest.fn()
    };
    User.findById.mockResolvedValue(mockUser);
    await requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('redirects non-admin to dashboard (non-API)', async () => {
    req.isAuthenticated.mockReturnValue(true);
    const mockUser = {
      _id: 'user123',
      email: 'regular@test.com',
      role: 'user',
      isAdmin: false,
      isModified: jest.fn().mockReturnValue(false),
      save: jest.fn()
    };
    User.findById.mockResolvedValue(mockUser);
    await requireAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/dashboard.html');
  });

  test('returns 403 for non-admin API requests', async () => {
    req.isAuthenticated.mockReturnValue(true);
    req.originalUrl = '/api/admin/stats';
    const mockUser = {
      _id: 'user123',
      email: 'regular@test.com',
      role: 'user',
      isAdmin: false,
      isModified: jest.fn().mockReturnValue(false),
      save: jest.fn()
    };
    User.findById.mockResolvedValue(mockUser);
    await requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Admin access required'
    });
  });

  test('redirects unauthenticated users', async () => {
    req.isAuthenticated.mockReturnValue(false);
    await requireAdmin(req, res, next);
    expect(res.redirect).toHaveBeenCalledWith('/dashboard.html');
  });
});
