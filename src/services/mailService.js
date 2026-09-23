const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.GMAIL_USER || process.env.EMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.EMAIL_PASS;
  if (!user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass: String(pass).replace(/\s+/g, ''),
    },
  });
}

function otpExpirySeconds() {
  return Number(process.env.OTP_EXPIRY_SECONDS || 300);
}

function otpResendCooldownSeconds() {
  return Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * @param {string} email
 * @param {string} otp
 * @param {'verify'|'reset'} purpose
 */
async function sendOtpEmail(email, otp, purpose = 'verify') {
  const transporter = createTransporter();
  const fromUser = process.env.GMAIL_USER || process.env.EMAIL_USER;
  if (!transporter || !fromUser) {
    console.error('SMTP not configured (GMAIL_USER / GMAIL_APP_PASSWORD)');
    return { success: false, error: 'Email service not configured' };
  }

  const isReset = purpose === 'reset';
  const subject = isReset
    ? 'HoldPose password reset code'
    : 'HoldPose email verification code';
  const headline = isReset ? 'Password reset' : 'Verify your email';
  const minutes = Math.max(1, Math.round(otpExpirySeconds() / 60));

  const mailOptions = {
    from: `"HoldPose" <${fromUser}>`,
    to: email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2 style="color: #FF6B35;">${headline}</h2>
        <p>Your HoldPose code is:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #FF6B35;">${otp}</p>
        <p>This code expires in ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
        <p>If you did not request this, you can ignore this email.</p>
      </div>
    `,
    text: `Your HoldPose code is ${otp}. It expires in ${minutes} minutes.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (error) {
    console.error('OTP email send error:', error.message);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}

module.exports = {
  generateOtp,
  sendOtpEmail,
  otpExpirySeconds,
  otpResendCooldownSeconds,
};
