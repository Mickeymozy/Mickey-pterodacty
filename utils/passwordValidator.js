/**
 * Password Validator Utility
 * Enforces strong password complexity requirements
 */

const validatePasswordComplexity = (password) => {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter (A-Z)");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter (a-z)");
  }

  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one numeric character (0-9)");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&* etc.)");
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
    strength: calculatePasswordStrength(password)
  };
};

const calculatePasswordStrength = (password) => {
  let strength = 0;

  if (password.length >= 8) strength += 5;
  if (password.length >= 12) strength += 5;
  if (password.length >= 16) strength += 10;

  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/\d/.test(password)) strength += 15;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) strength += 20;

  const charTypes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter(regex => regex.test(password)).length;
  if (charTypes === 4) strength += 5;

  return Math.min(100, strength);
};

const getStrengthLabel = (strength) => {
  if (strength >= 80) return "Very Strong";
  if (strength >= 60) return "Strong";
  if (strength >= 40) return "Medium";
  if (strength >= 20) return "Weak";
  return "Very Weak";
};

module.exports = {
  validatePasswordComplexity,
  calculatePasswordStrength,
  getStrengthLabel
};
