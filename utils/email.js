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
const APP_URL = (process.env.APP_URL || 'https://leonodes.xyz').replace(/\/$/, '');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || SMTP_FROM;
const BRAND_COLOR = process.env.EMAIL_BRAND_COLOR || '#0f766e';

let transporter = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

function wrapEmailHtml({ subject, html, text }) {
  if (!html) {
    html = `<p style="margin:0; white-space:pre-line;">${escapeHtml(text || '')}</p>`;
  }

  if (/<html[\s>]/i.test(html)) return html;

  const preheader = escapeHtml(String(text || subject || '').replace(/\s+/g, ' ').trim().slice(0, 140));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject || SMTP_FROM_NAME)}</title>
  </head>
  <body style="margin:0; padding:0; background:#eef3f5; color:#172a2b; font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3f5; width:100%;">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px; width:100%;">
            <tr>
              <td style="padding:0 8px 16px;">
                <a href="${APP_URL}" style="color:${BRAND_COLOR}; text-decoration:none; font-size:20px; font-weight:700; letter-spacing:.2px;">${escapeHtml(SMTP_FROM_NAME)}</a>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff; border:1px solid #dbe5e6; border-radius:16px; padding:32px 30px; box-shadow:0 8px 24px rgba(23,42,43,.07);">
                <div style="font-size:15px; line-height:1.7;">${html}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 8px 0; color:#718083; font-size:12px; line-height:1.6;">
                <p style="margin:0 0 6px;">Ujumbe huu umetumwa na ${escapeHtml(SMTP_FROM_NAME)}.</p>
                <p style="margin:0;">${SUPPORT_EMAIL ? `Msaada: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${BRAND_COLOR};">${escapeHtml(SUPPORT_EMAIL)}</a> · ` : ''}<a href="${APP_URL}" style="color:${BRAND_COLOR};">Fungua dashboard</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

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

async function sendEmail({ to, subject, html, text, bcc }) {
  if (!transporter || !to) {
    console.warn(`⚠️ Email not sent to ${to || 'unknown'} because SMTP is not configured.`);
    return false;
  }

  try {
    const mailOptions = {
      to,
      subject,
      html: wrapEmailHtml({ subject, html, text }),
      text,
      priority: 'high'
    };

    if (bcc) {
      mailOptions.bcc = bcc;
    }

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
