const crypto = require('crypto');

function generateResetToken() {
  const characters = [
    ...Array.from({ length: 4 }, () => String.fromCharCode(65 + crypto.randomInt(26))),
    ...Array.from({ length: 4 }, () => String(crypto.randomInt(10)))
  ];

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }

  return characters.join('');
}

function createAttemptLimiter(limit, windowMs) {
  const attemptsByKey = new Map();

  return (key, now = Date.now()) => {
    const normalizedKey = String(key || 'unknown');
    const current = attemptsByKey.get(normalizedKey);

    if (!current || now - current.startedAt >= windowMs) {
      attemptsByKey.set(normalizedKey, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;

    current.count += 1;
    return true;
  };
}

module.exports = { generateResetToken, createAttemptLimiter };