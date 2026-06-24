import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler, isValidEmail } from "../lib/http.js";
import { sendPasswordReset } from "../lib/mailer.js";

const router = Router();

// Throttle credential endpoints: slow password brute-forcing and reset-email spam.
const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, max: 20 });
const registerLimiter = rateLimit({ name: "register", windowMs: 60 * 60_000, max: 10 });
const resetLimiter = rateLimit({ name: "reset", windowMs: 60 * 60_000, max: 10 });

// "Remember me" -> long-lived token; otherwise a short one the client keeps only
// for the browser session.
const signToken = (user, remember = true) =>
  jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: remember ? "30d" : "1d" });
const userPayload = (u) => ({ id: u._id, email: u.email });

// Base URL for the reset link in the email:
//   1. APP_URL env wins (explicit override)
//   2. otherwise the origin the request came in on (works in dev and prod)
const baseUrl = (req) => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
};

// POST /register — open registration: create the account and sign in immediately.
router.post(
  "/register",
  registerLimiter,
  asyncHandler(async (req, res) => {
    const email = (typeof req.body.email === "string" ? req.body.email : "").trim().toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email address" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    if (await User.findOne({ email })) return res.status(409).json({ error: "An account with this email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    res.status(201).json({ token: signToken(user, req.body.remember !== false), user: userPayload(user) });
  })
);

// POST /login
router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email = (typeof req.body.email === "string" ? req.body.email : "").trim().toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "Incorrect email or password" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Incorrect email or password" });
    res.json({ token: signToken(user, req.body.remember !== false), user: userPayload(user) });
  })
);

// GET /me — current user from the Bearer token.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: userPayload(req.user) });
  })
);

// POST /forgot-password — issue a single-use reset token and email the link.
// Always responds 200 (never reveals whether the email exists).
router.post(
  "/forgot-password",
  resetLimiter,
  asyncHandler(async (req, res) => {
    const email = (typeof req.body.email === "string" ? req.body.email : "").trim().toLowerCase();
    const generic = { ok: true, message: "If that email has an account, a reset link is on its way." };
    if (!isValidEmail(email)) return res.json(generic);

    const user = await User.findOne({ email });
    if (user) {
      const raw = crypto.randomBytes(32).toString("hex");
      user.resetTokenHash = crypto.createHash("sha256").update(raw).digest("hex");
      user.resetExpires = new Date(Date.now() + 60 * 60_000); // 1 hour
      await user.save();
      const resetUrl = `${baseUrl(req)}/reset?token=${raw}&email=${encodeURIComponent(email)}`;
      try {
        await sendPasswordReset({ email, resetUrl });
      } catch (e) {
        console.error("[reset] failed to send reset email:", e.message);
      }
    }
    res.json(generic);
  })
);

// POST /reset-password — consume the token and set a new password.
router.post(
  "/reset-password",
  resetLimiter,
  asyncHandler(async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!token || password.length < 8) return res.status(400).json({ error: "Invalid token or password too short" });

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({ resetTokenHash: hash, resetExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: "This reset link is invalid or has expired" });

    user.passwordHash = await bcrypt.hash(password, 10);
    user.resetTokenHash = null;
    user.resetExpires = null;
    await user.save();
    res.json({ token: signToken(user), user: userPayload(user) });
  })
);

export default router;
