const {
  calculateTotalCost,
  formatCurrency,
  calculateExpirationDate
} = require('../utils/paymentHelper');

describe('calculateTotalCost', () => {
  test('calculates total with default fee percentage (2.9%)', () => {
    const result = calculateTotalCost(100);
    expect(result).toBeCloseTo(102.9);
  });

  test('calculates total with custom fee percentage', () => {
    const result = calculateTotalCost(100, 5);
    expect(result).toBeCloseTo(105);
  });

  test('handles zero base cost', () => {
    const result = calculateTotalCost(0);
    expect(result).toBe(0);
  });

  test('handles large amounts', () => {
    const result = calculateTotalCost(10000, 2.9);
    expect(result).toBeCloseTo(10290);
  });

  test('handles decimal base costs', () => {
    const result = calculateTotalCost(49.99, 2.9);
    const expected = 49.99 + 49.99 * (2.9 / 100);
    expect(result).toBeCloseTo(expected);
  });

  test('handles zero fee percentage', () => {
    const result = calculateTotalCost(100, 0);
    expect(result).toBe(100);
  });
});

describe('formatCurrency', () => {
  test('formats USD with dollar sign and 2 decimals', () => {
    expect(formatCurrency(9.99, 'USD')).toBe('$9.99');
  });

  test('formats USD as default currency', () => {
    expect(formatCurrency(25)).toBe('$25.00');
  });

  test('formats coins with floor value', () => {
    expect(formatCurrency(100, 'coins')).toBe('100 coins');
  });

  test('floors coin amounts (no decimals)', () => {
    expect(formatCurrency(99.7, 'coins')).toBe('99 coins');
  });

  test('formats zero USD', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });

  test('formats zero coins', () => {
    expect(formatCurrency(0, 'coins')).toBe('0 coins');
  });

  test('formats large USD amounts', () => {
    expect(formatCurrency(1234.56, 'USD')).toBe('$1234.56');
  });
});

describe('calculateExpirationDate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('calculates hourly expiration', () => {
    const result = calculateExpirationDate('hourly');
    const expected = new Date('2025-01-15T13:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  test('calculates daily expiration', () => {
    const result = calculateExpirationDate('daily');
    const expected = new Date('2025-01-16T12:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  test('calculates monthly expiration', () => {
    const result = calculateExpirationDate('monthly');
    const expected = new Date('2025-02-15T12:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  test('calculates yearly expiration', () => {
    const result = calculateExpirationDate('yearly');
    const expected = new Date('2026-01-15T12:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  test('defaults to monthly for unknown billing cycle', () => {
    const result = calculateExpirationDate('unknown');
    const expected = new Date('2025-02-15T12:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  test('returns a Date object', () => {
    const result = calculateExpirationDate('monthly');
    expect(result).toBeInstanceOf(Date);
  });

  test('expiration is always in the future', () => {
    const now = new Date();
    const result = calculateExpirationDate('hourly');
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });
});
