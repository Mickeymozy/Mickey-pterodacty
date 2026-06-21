const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });
} else {
  console.warn('⚠️ SMTP is not configured. Email delivery is disabled.');
}

async function sendEmail({ to, subject, html, text }) {
  if (!transporter || !to) {
    console.warn(`⚠️ Email not sent to ${to || 'unknown'} because SMTP is not configured.`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
      text
    });
    return true;
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    return false;
  }
}

module.exports = sendEmail;
