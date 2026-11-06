
const nodemailer = require("nodemailer");
const logger = require("./logger");

let transporter = null;

// Counts emails requested during this process.
let testEmailCount = 0;

function getMailClient() {
  if (transporter) return transporter;

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  // No credentials: log-only mode for local development.
  if (!user || !pass) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  return transporter;
}

async function sendEmail({
  to,
  subject,
  text,
  html,
  category = "Legacy Vault",
}) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);

  if (recipients.length === 0) {
    return { sent: false, counted: false };
  }

  // TEST MODE: count emails without sending them.
  if (process.env.EMAIL_TEST_MODE === "true") {
    testEmailCount += recipients.length;

    logger.info("email_counted_test_mode", {
      subject,
      recipientCount: recipients.length,
      totalCount: testEmailCount,
      category,
    });

    return {
      sent: false,
      counted: true,
      count: recipients.length,
      totalCount: testEmailCount,
    };
  }

  const mailClient = getMailClient();

  if (!mailClient) {
    logger.info("email_not_sent_smtp_not_configured", {
      subject,
      recipientCount: recipients.length,
    });

    return { sent: false, counted: false };
  }

  const fromEmail = process.env.MAIL_FROM_EMAIL?.trim();
  const fromName = process.env.MAIL_FROM_NAME || "Legacy Vault";

  if (!fromEmail) {
    logger.error("email_send_failed", {
      subject,
      message: "MAIL_FROM_EMAIL is not configured",
    });

    return { sent: false, counted: false };
  }

  try {
    const info = await mailClient.sendMail({
      from: `"${fromName.replace(/["\r\n]/g, "")}" <${fromEmail}>`,
      to: recipients,
      subject,
      text,
      html,
      headers: {
        "X-Email-Category": category
          .replace(/[\r\n]/g, "")
          .slice(0, 200),
      },
    });

    logger.info("email_sent", {
      subject,
      recipientCount: recipients.length,
      messageId: info.messageId,
      provider: "gmail_smtp",
    });

    return { sent: true };
  } catch (err) {
    logger.error("email_send_failed", {
      subject,
      message: err.message,
      provider: "gmail_smtp",
    });

    return { sent: false, error: err.message };
  }
}

// Useful for tests and diagnostics.
function getEmailTestCount() {
  return testEmailCount;
}

function resetEmailTestCount() {
  testEmailCount = 0;
}

module.exports = {
  sendEmail,
  getEmailTestCount,
  resetEmailTestCount,
};
