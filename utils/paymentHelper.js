/**
 * Payment Helper Utilities
 */

const calculateTotalCost = (baseCost, feePercentage = 2.9) => {
  const fee = baseCost * (feePercentage / 100);
  return baseCost + fee;
};

const formatCurrency = (amount, currency = 'USD') => {
  if (currency === 'coins') {
    return `${Math.floor(amount)} coins`;
  }
  return `$${amount.toFixed(2)}`;
};

const calculateExpirationDate = (billingCycle) => {
  const today = new Date();
  const expiration = new Date(today);

  switch (billingCycle) {
    case 'hourly':
      expiration.setHours(expiration.getHours() + 1);
      break;
    case 'daily':
      expiration.setDate(expiration.getDate() + 1);
      break;
    case 'monthly':
      expiration.setMonth(expiration.getMonth() + 1);
      break;
    case 'yearly':
      expiration.setFullYear(expiration.getFullYear() + 1);
      break;
    default:
      expiration.setMonth(expiration.getMonth() + 1);
  }

  return expiration;
};

module.exports = {
  calculateTotalCost,
  formatCurrency,
  calculateExpirationDate
};
