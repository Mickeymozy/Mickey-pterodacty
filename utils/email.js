const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === undefined
  ? SMTP_PORT === 465
  : process.env.SMTP_SECURE !== 'false';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'LeoNodes';

let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    requireTLS: SMTP_PORT === 587,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    pool: true,
    maxConnections: 3
  });

  transporter.verify().then(() => {
    console.log('✅ SMTP transport is ready.');
  }).catch((err) => {
    console.warn('⚠️ SMTP transport verification failed:', err.message);
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
    const mailOptions = {
      to,
      subject,
      html,
      text,
      priority: 'high'
    };

    if (SMTP_FROM) {
      mailOptions.from = `"${SMTP_FROM_NAME}" <${SMTP_FROM}>`;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to} (${info.messageId})`);
    return true;
  } catch (err) {
    console.error('❌ Email send failed:', err.message);
    if (err.response) {
      console.error('SMTP response:', err.response);
    }
    return false;
  }
}

module.exports = sendEmail;
