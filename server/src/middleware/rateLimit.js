// Lightweight in-memory fixed-window rate limiter — no external deps, fine for a
// single web instance. Counters live in process memory (reset on restart, not
// shared across instances). If you scale out, swap for a Redis-backed limiter.
const buckets = new Map();

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (now >= entry.reset) buckets.delete(key);
}, 60_000);
sweep.unref?.();

const DEFAULT_MSG = "Too many requests — try again in a moment.";

// Keyed by client IP (needs app.set('trust proxy', …) so req.ip is the real client).
export function rateLimit({ windowMs, max, name = "rl", message = DEFAULT_MSG }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let entry = buckets.get(key);
    if (!entry || now >= entry.reset) {
      entry = { count: 0, reset: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
