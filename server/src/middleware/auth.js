import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Verifies the Bearer token and loads the user. Attaches req.userId + req.user.
// Sends 401 if the token is missing/invalid or the user no longer exists.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Session expired — sign in again" });
  }
  let user;
  try {
    user = await User.findById(payload.sub);
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
  if (!user) return res.status(401).json({ error: "Session expired — sign in again" });
  req.userId = user._id.toString();
  req.user = user;
  next();
}
