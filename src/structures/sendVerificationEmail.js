const nodemailer = require("nodemailer");

// Load credentials from environment variables
const SMTP_USER = ""; // Set your Zoho SMTP user here or in environment variables
const SMTP_PASS = ""; // Set your Zoho SMTP password here or in environment variables

if (!SMTP_PASS) {
  throw new Error("Missing SMTP password. Set ZOHO_SMTP_PASS in environment.");
}

// Configure transporter
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.in",
  port: 465,
  secure: true,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
  logger: true,
  debug: false, // Set to true for debugging
  connectionTimeout: 10000,
  greetingTimeout: 5000,
});

// Send verification email
module.exports = async function sendVerificationEmail(email, code) {
  if (!email || !code) {
    throw new Error("Email and verification code are required.");
  }

  try {
    const result = await transporter.sendMail({
      from: `"LeoNodes" <${SMTP_USER}>`,
      to: email,
      subject: "LeoNodes Email Verification",
      html: `
        <div style="font-family:sans-serif; padding:20px; background:#f9f9f9; border-radius:8px;">
          <h2 style="color:#333;">Verify Your Email</h2>
          <p>Your one-time verification code is:</p>
          <div style="font-size:22px; font-weight:bold; margin:10px 0; color:#000;">${code}</div>
          <p>This code will expire in <strong>5 minutes</strong>.</p>
          <p style="margin-top:20px; color:#555;">If you didn’t request this, you can safely ignore this email.</p>
          <p style="margin-top:30px; font-size:13px; color:#888;">
            ⚠️ <strong>Please do not reply to this email.</strong> This mailbox is not monitored.
          </p>
          <hr style="margin:20px 0; border:none; border-top:1px solid #ddd;" />
          <footer style="font-size:12px; color:#aaa;">
            LeoNodes • <a href="https://leonodes.xyz" style="color:#888; text-decoration:none;">https://leonodes.xyz</a>
          </footer>
        </div>
      `,
    });

    console.log(`✅ Verification email sent to ${email}`, result.messageId);
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error);
    throw error;
  }
};
