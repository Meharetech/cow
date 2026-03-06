const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
  }

  getTransporter() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });
    }
    return this.transporter;
  }

  async sendOTP(email, otp, name) {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Verify Your Email - Cow Rescue',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; border: 2px dashed #667eea; padding: 20px; text-align: center; margin: 20px 0; border-radius: 10px; }
            .otp-code { font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🐄 Cow Rescue</h1>
              <p>Email Verification</p>
            </div>
            <div class="content">
              <h2>Hello ${name || 'User'}!</h2>
              <p>Thank you for registering with Cow Rescue. Please use the following OTP to verify your email address:</p>
              
              <div class="otp-box">
                <p style="margin: 0; color: #666;">Your OTP Code</p>
                <div class="otp-code">${otp}</div>
                <p style="margin: 10px 0 0 0; color: #999; font-size: 14px;">Valid for ${process.env.OTP_EXPIRY_MINUTES} minutes</p>
              </div>
              
              <p><strong>Important:</strong></p>
              <ul>
                <li>Do not share this OTP with anyone</li>
                <li>This OTP will expire in ${process.env.OTP_EXPIRY_MINUTES} minutes</li>
                <li>If you didn't request this, please ignore this email</li>
              </ul>
              
              <p>Together, we can save lives! 🙏</p>
            </div>
            <div class="footer">
              <p>© 2024 Cow Rescue. All rights reserved.</p>
              <p>This is an automated email. Please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await this.getTransporter().sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(email, name, role) {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Welcome to Cow Rescue!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🐄 Welcome to Cow Rescue!</h1>
            </div>
            <div class="content">
              <h2>Hello ${name}!</h2>
              <p>Your account has been successfully verified. You can now start ${role === 'citizen' ? 'reporting cases and helping animals in need' : 'responding to rescue requests'}.</p>
              <p>Thank you for joining our mission to protect and care for animals!</p>
              <p>Best regards,<br>The Cow Rescue Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await this.getTransporter().sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendNGOApprovalEmail(email, organizationName, approved) {
    const subject = approved ? 'NGO Registration Approved!' : 'NGO Registration Update';
    const message = approved
      ? `Congratulations! Your organization "${organizationName}" has been approved. You can now login and start responding to rescue cases.`
      : `We regret to inform you that your organization "${organizationName}" registration could not be approved at this time. Please contact support for more information.`;

    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${approved ? '#10b981' : '#ef4444'}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${approved ? '✅' : '❌'} ${subject}</h1>
            </div>
            <div class="content">
              <p>${message}</p>
              ${approved ? '<p>You can now login and start making a difference!</p>' : ''}
              <p>Best regards,<br>The Cow Rescue Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await this.getTransporter().sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPasswordResetOTP(email, otp, name) {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Reset Your Password - Cow Rescue',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #6366f1; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; border: 2px dashed #6366f1; padding: 20px; text-align: center; margin: 20px 0; border-radius: 10px; }
            .otp-code { font-size: 32px; font-weight: bold; color: #6366f1; letter-spacing: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🐄 Cow Rescue</h1>
              <p>Password Reset</p>
            </div>
            <div class="content">
              <h2>Hello ${name || 'User'}!</h2>
              <p>We received a request to reset your password. Use the following OTP code to proceed:</p>
              
              <div class="otp-box">
                <p style="margin: 0; color: #666;">Reset OTP Code</p>
                <div class="otp-code">${otp}</div>
                <p style="margin: 10px 0 0 0; color: #999; font-size: 14px;">Valid for ${process.env.OTP_EXPIRY_MINUTES} minutes</p>
              </div>
              
              <p>If you didn't request this reset, please ignore this email or contact support.</p>
              <p>Best regards,<br>The Cow Rescue Team</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    try {
      await this.getTransporter().sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Password reset email error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();
