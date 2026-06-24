import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import exercises from "./routes/exercises.js";
import progress from "./routes/progress.js";
import read from "./routes/read.js";
import auth from "./routes/auth.js";

const app = express();
app.set("trust proxy", 1);                   // real client IP behind a proxy (for rate limiting)
app.use(cors());
app.use(express.json({ limit: "25mb" }));   // exercise images are dataURLs

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Add it to server/.env.");
  process.exit(1);
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", auth);
app.use("/api/exercises", exercises);
app.use("/api/progress", progress);          // requireAuth applied inside the router
app.use("/api/read", read);

// Serve the built React client and fall back to index.html for client-side routes.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

// Centralized error handler — keeps a thrown/rejected handler from crashing the
// process (asyncHandler forwards rejections here).
app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Server error" });
});

const PORT = process.env.PORT || 4001;
const URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/stickcontrol";

connectDB(URI)
  .then(() => app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`)))
  .catch((e) => { console.error("DB connection failed:", e.message); process.exit(1); });
