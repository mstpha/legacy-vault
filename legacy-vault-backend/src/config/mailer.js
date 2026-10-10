const { MailtrapClient } = require("mailtrap");
const logger = require("./logger");

// Same pattern as config/supabase.js: one lazily-created client, configured from env.
// If MAILTRAP_API_KEY is blank, emails are only logged (nothing is sent), so local
// development works without any email setup.

let client = null;

const useSandbox = () => process.env.MAILTRAP_USE_SANDBOX === "true";

function getMailClient() {
  if (client) return client;

  if (!process.env.MAILTRAP_API_KEY) return null;

  if (useSandbox() && !process.env.MAILTRAP_INBOX_ID) {
    logger.warn("MAILTRAP_USE_SANDBOX=true but MAILTRAP_INBOX_ID is not set — emails will only be logged.");
    return null;
  }

  client = new MailtrapClient({
    token: process.env.MAILTRAP_API_KEY,
    ...(useSandbox() ? { sandbox: true, testInboxId: Number(process.env.MAILTRAP_INBOX_ID) } : {}),
  });
  return client;
}

/**
 * Send an email. Never throws — a failed email must not break the request or the
 * inactivity sweep that triggered it. Returns { sent: boolean }.
 *
 * Don't `await` it on a request path unless you need the result; calling it without
 * await keeps API responses fast.
 */
async function sendEmail({ to, subject, text, html, category = "Legacy Vault" }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).map((email) => ({ email }));
  if (recipients.length === 0) return { sent: false };

  const mailClient = getMailClient();
  if (!mailClient) {
    logger.info("email_not_sent_mailtrap_not_configured", { to, subject });
    return { sent: false };
  }

  const message = {
    from: {
      email: process.env.MAIL_FROM_EMAIL || "hello@demomailtrap.co",
      name: process.env.MAIL_FROM_NAME || "Legacy Vault",
    },
    to: recipients,
    subject,
    category,
  };
  if (text) message.text = text;
  if (html) message.html = html;

  try {
    await mailClient.send(message);
    logger.info("email_sent", { to, subject, sandbox: useSandbox() });
    return { sent: true };
  } catch (err) {
    logger.error("email_send_failed", { to, subject, message: err.message });
    return { sent: false, error: err.message };
  }
}

module.exports = { sendEmail };