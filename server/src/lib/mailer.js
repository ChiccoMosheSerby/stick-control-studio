import nodemailer from "nodemailer";

// Build an SMTP transport from env, or null if SMTP isn't configured.
// Supported env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
let _transport;
function transport() {
  if (_transport !== undefined) return _transport;
  const host = process.env.SMTP_HOST;
  if (!host) {
    _transport = null;
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transport;
}

const from = () => process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@stickcontrol.app";

// Email a password-reset link. Falls back to logging the link to the console
// when SMTP isn't configured, so the flow still works in development.
export async function sendPasswordReset({ email, resetUrl }) {
  const subject = "Stick Control · Studio — reset your password";
  const text =
    `We received a request to reset the password for ${email}.\n\n` +
    `Reset it here (link valid for 1 hour):\n${resetUrl}\n\n` +
    `If you didn't request this, you can safely ignore this email.`;
  const html =
    `<p>We received a request to reset the password for <strong>${email}</strong>.</p>` +
    `<p><a href="${resetUrl}">Click here to reset your password</a> (link valid for 1 hour).</p>` +
    `<p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`;

  const t = transport();
  if (!t) {
    console.log("\n[reset] SMTP not configured — password-reset link for", email + ":");
    console.log("[reset]", resetUrl, "\n");
    return { delivered: false };
  }
  await t.sendMail({ from: from(), to: email, subject, text, html });
  console.log("[reset] password-reset email sent to", email);
  return { delivered: true };
}
