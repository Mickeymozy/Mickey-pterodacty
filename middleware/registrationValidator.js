/**
 * Registration Validation Middleware
 */

const { validatePasswordComplexity, getStrengthLabel } = require('../utils/passwordValidator');

const validateRegistration = (req, res, next) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required'
    });
  }

  if (username.length < 3 || username.length > 30) {
    return res.status(400).json({
      success: false,
      message: 'Username must be between 3 and 30 characters'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid email format'
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match'
    });
  }

  const passwordValidation = validatePasswordComplexity(password);
  if (!passwordValidation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Password does not meet complexity requirements',
      errors: passwordValidation.errors,
      strength: {
        score: passwordValidation.strength,
        label: getStrengthLabel(passwordValidation.strength)
      }
    });
  }

  req.validatedData = {
    username,
    email: email.toLowerCase(),
    password,
    passwordStrength: passwordValidation.strength
  };

  next();
};

const getPasswordRequirements = (req, res) => {
  res.json({
    success: true,
    requirements: [
      { rule: 'At least 8 characters long', code: 'LENGTH' },
      { rule: 'Contains uppercase letter (A-Z)', code: 'UPPERCASE' },
      { rule: 'Contains lowercase letter (a-z)', code: 'LOWERCASE' },
      { rule: 'Contains numeric character (0-9)', code: 'NUMERIC' },
      { rule: 'Contains special character (!@#$%^&* etc.)', code: 'SPECIAL' }
    ]
  });
};

module.exports = {
  validateRegistration,
  getPasswordRequirements
};
