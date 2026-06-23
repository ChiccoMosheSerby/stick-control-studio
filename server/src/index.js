import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./db.js";
import exercises from "./routes/exercises.js";
import progress from "./routes/progress.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));   // exercise images are dataURLs

app.get("/", (_req, res) => res.json({ service: "stick-control-studio API", health: "/api/health" }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/exercises", exercises);
app.use("/api/progress", progress);

const PORT = process.env.PORT || 4001;
const URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/stickcontrol";

connectDB(URI)
  .then(() => app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`)))
  .catch((e) => { console.error("DB connection failed:", e.message); process.exit(1); });
