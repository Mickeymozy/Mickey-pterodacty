const sendEmail = require('../../utils/email');

module.exports = async function sendVerificationEmail(email, code) {
  if (!email || !code) {
    throw new Error('Email and verification code are required.');
  }

  return sendEmail({
    to: email,
    subject: 'Thibitisha email yako ya LeoNodes',
    html: `
      <p style="margin:0 0 8px; color:#506466;">Usajili wa akaunti</p>
      <h1 style="margin:0 0 18px; color:#173638; font-size:26px;">Thibitisha email yako</h1>
      <p style="margin:0 0 18px;">Msimbo wako wa kuthibitisha email ni:</p>
      <div style="margin:0 0 20px; padding:18px; border:1px solid #b9ded8; border-radius:12px; background:#effaf8; color:#0f766e; font-size:32px; font-weight:700; letter-spacing:8px; text-align:center;">${code}</div>
      <p style="margin:0 0 16px; color:#506466;">Msimbo huu utaisha baada ya <strong>dakika 5</strong>.</p>
      <p style="margin:0; color:#718083; font-size:13px;">Kama hukuomba ujumbe huu, unaweza kuupuuza. Tafadhali usijibu email hii moja kwa moja.</p>
    `,
    text: `Msimbo wako wa kuthibitisha email ni ${code}. Msimbo huu utaisha baada ya dakika 5.`
  });
};
