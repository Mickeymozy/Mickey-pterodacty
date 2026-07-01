const {
  validatePasswordComplexity,
  calculatePasswordStrength,
  getStrengthLabel
} = require('../utils/passwordValidator');

describe('validatePasswordComplexity', () => {
  test('returns invalid for empty password', () => {
    const result = validatePasswordComplexity('');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters long');
  });

  test('throws on null/undefined password (calculatePasswordStrength lacks null guard)', () => {
    expect(() => validatePasswordComplexity(null)).toThrow();
    expect(() => validatePasswordComplexity(undefined)).toThrow();
  });

  test('returns invalid for password shorter than 8 chars', () => {
    const result = validatePasswordComplexity('Ab1!xyz');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must be at least 8 characters long');
  });

  test('returns invalid when missing uppercase', () => {
    const result = validatePasswordComplexity('abcdefg1!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one uppercase letter (A-Z)');
  });

  test('returns invalid when missing lowercase', () => {
    const result = validatePasswordComplexity('ABCDEFG1!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one lowercase letter (a-z)');
  });

  test('returns invalid when missing numeric character', () => {
    const result = validatePasswordComplexity('Abcdefgh!');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one numeric character (0-9)');
  });

  test('returns invalid when missing special character', () => {
    const result = validatePasswordComplexity('Abcdefg1');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password must contain at least one special character (!@#$%^&* etc.)');
  });

  test('returns valid for a password meeting all criteria', () => {
    const result = validatePasswordComplexity('StrongP@ss1');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('returns multiple errors for very weak password', () => {
    const result = validatePasswordComplexity('abc');
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  test('includes strength score in result', () => {
    const result = validatePasswordComplexity('StrongP@ss1');
    expect(result.strength).toBeDefined();
    expect(typeof result.strength).toBe('number');
    expect(result.strength).toBeGreaterThan(0);
  });
});

describe('calculatePasswordStrength', () => {
  test('returns 0 for empty string', () => {
    const strength = calculatePasswordStrength('');
    expect(strength).toBe(0);
  });

  test('gives points for length >= 8', () => {
    const short = calculatePasswordStrength('abcdefg');
    const long = calculatePasswordStrength('abcdefgh');
    expect(long).toBeGreaterThan(short);
  });

  test('gives additional points for length >= 12', () => {
    const eight = calculatePasswordStrength('abcdefgh');
    const twelve = calculatePasswordStrength('abcdefghijkl');
    expect(twelve).toBeGreaterThan(eight);
  });

  test('gives additional points for length >= 16', () => {
    const twelve = calculatePasswordStrength('abcdefghijkl');
    const sixteen = calculatePasswordStrength('abcdefghijklmnop');
    expect(sixteen).toBeGreaterThan(twelve);
  });

  test('gives points for lowercase letters', () => {
    const noLower = calculatePasswordStrength('ABCD1234');
    const withLower = calculatePasswordStrength('ABCd1234');
    expect(withLower).toBeGreaterThan(noLower);
  });

  test('gives points for uppercase letters', () => {
    const noUpper = calculatePasswordStrength('abcd1234');
    const withUpper = calculatePasswordStrength('Abcd1234');
    expect(withUpper).toBeGreaterThan(noUpper);
  });

  test('gives points for digits', () => {
    const noDigit = calculatePasswordStrength('abcdefgh');
    const withDigit = calculatePasswordStrength('abcdefg1');
    expect(withDigit).toBeGreaterThan(noDigit);
  });

  test('gives points for special characters', () => {
    const noSpecial = calculatePasswordStrength('Abcdefg1');
    const withSpecial = calculatePasswordStrength('Abcdef1!');
    expect(withSpecial).toBeGreaterThan(noSpecial);
  });

  test('caps at 100', () => {
    const strength = calculatePasswordStrength('SuperStr0ng!P@ssword123');
    expect(strength).toBeLessThanOrEqual(100);
  });

  test('gives bonus for all 4 character types', () => {
    const threeTypes = calculatePasswordStrength('Abcdefg1');
    const fourTypes = calculatePasswordStrength('Abcdef1!');
    expect(fourTypes).toBeGreaterThan(threeTypes);
  });
});

describe('getStrengthLabel', () => {
  test('returns "Very Weak" for strength < 20', () => {
    expect(getStrengthLabel(0)).toBe('Very Weak');
    expect(getStrengthLabel(19)).toBe('Very Weak');
  });

  test('returns "Weak" for strength 20-39', () => {
    expect(getStrengthLabel(20)).toBe('Weak');
    expect(getStrengthLabel(39)).toBe('Weak');
  });

  test('returns "Medium" for strength 40-59', () => {
    expect(getStrengthLabel(40)).toBe('Medium');
    expect(getStrengthLabel(59)).toBe('Medium');
  });

  test('returns "Strong" for strength 60-79', () => {
    expect(getStrengthLabel(60)).toBe('Strong');
    expect(getStrengthLabel(79)).toBe('Strong');
  });

  test('returns "Very Strong" for strength >= 80', () => {
    expect(getStrengthLabel(80)).toBe('Very Strong');
    expect(getStrengthLabel(100)).toBe('Very Strong');
  });
});
