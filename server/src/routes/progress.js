import { Router } from "express";
import ProgressLog from "../models/ProgressLog.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../lib/http.js";

const router = Router();

// All progress is scoped to the signed-in user.
router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
  const docs = await ProgressLog.find({ userId: req.userId }).lean();
  const map = {};
  for (const d of docs) map[d.exerciseId] = d;
  res.json(map);
}));

router.put("/", asyncHandler(async (req, res) => {
  const map = req.body || {};
  const ops = Object.entries(map).map(([exerciseId, v]) => ({
    updateOne: {
      filter: { userId: req.userId, exerciseId },
      update: { $set: { sec: v.sec || 0, reps: v.reps || 0, bestTempo: v.bestTempo || 0, done: !!v.done, userId: req.userId, exerciseId } },
      upsert: true
    }
  }));
  if (ops.length) await ProgressLog.bulkWrite(ops);
  res.json({ ok: true, count: ops.length });
}));

// Reset all practice memory for the signed-in user. A PUT with an empty map can't do
// this (it only upserts the keys it's given), so deletion needs its own endpoint.
router.delete("/", asyncHandler(async (req, res) => {
  const { deletedCount } = await ProgressLog.deleteMany({ userId: req.userId });
  res.json({ ok: true, deleted: deletedCount });
}));

export default router;
