// Builds a structured email (HTML + plain-text fallback) from a notification.
// Table-based layout with inline CSS, because that is what email clients support.

const TONE_COLORS = {
  info: "#3b82f6",
  warning: "#f59e0b",
  action: "#6366f1",
  success: "#22c55e",
  danger: "#ef4444",
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function renderEmail({ recipientName, title, message, tone = "info", details = [] }) {
  const color = TONE_COLORS[tone] || TONE_COLORS.info;
  const firstName = (recipientName || "").trim().split(" ")[0] || "there";
  const appUrl = process.env.APP_URL || ""; // optional: a link that opens your app/site

  const detailRows = details
    .map(
      (d) => `
        <tr>
          <td style="padding:6px 0;width:120px;color:#64748b;font-size:13px;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(d.value)}</td>
        </tr>`
    )
    .join("");

  const detailsBlock = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;padding:12px 16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">${detailRows}</table>`
    : "";

  const button = appUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr><td style="background:#0f172a;border-radius:10px;"><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Open Digital Legacy Vault</a></td></tr></table>`
    : "";

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(message.slice(0, 110))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
            <tr>
              <td style="padding:0 0 14px;text-align:center;font-size:12px;font-weight:700;letter-spacing:0.12em;color:#64748b;">
                DIGITAL LEGACY VAULT
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
                <div style="height:6px;background:${color};line-height:6px;font-size:6px;">&nbsp;</div>
                <div style="padding:28px 28px 30px;">
                  <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#0f172a;">${escapeHtml(title)}</h1>
                  <p style="margin:0 0 18px;font-size:14px;color:#64748b;">Hi ${escapeHtml(firstName)},</p>
                  <p style="margin:0;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(message)}</p>
                  ${detailsBlock}
                  <p style="margin:22px 0 0;font-size:14px;line-height:1.6;color:#475569;">
                    Open the <strong>Digital Legacy Vault</strong> app and go to <strong>Notifications</strong> to see this and take any action.
                  </p>
                  ${button}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 8px 0;text-align:center;font-size:12px;line-height:1.6;color:#94a3b8;">
                You're receiving this because of activity on a capsule you're connected to.<br />
                This is an automated message - please don't reply to it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Hi ${firstName},`,
    "",
    title.toUpperCase(),
    "",
    message,
    ...(details.length ? ["", ...details.map((d) => `${d.label}: ${d.value}`)] : []),
    "",
    "Open the Digital Legacy Vault app and go to Notifications to see this and take any action.",
    ...(appUrl ? ["", appUrl] : []),
    "",
    "- Digital Legacy Vault",
  ].join("\n");

  return { html, text };
}

module.exports = { renderEmail };