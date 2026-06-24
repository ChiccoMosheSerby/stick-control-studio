// Small HTTP helpers shared across routes.

// Wrap an async Express handler so a rejected promise is forwarded to the error
// middleware instead of hanging the request. Express 4 does not await handlers.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Escape the five HTML-significant characters so user-controlled strings can be
// embedded safely in server-rendered HTML (e.g. emails).
export function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Conservative RFC-5321-ish email check: one @, no whitespace, a dotted domain.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const isValidEmail = (email) => typeof email === "string" && EMAIL_RE.test(email);
