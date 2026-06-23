import { Router } from "express";
import ProgressLog from "../models/ProgressLog.js";

const router = Router();

router.get("/", async (_req, res) => {
  const docs = await ProgressLog.find().lean();
  const map = {};
  for (const d of docs) map[d.exerciseId] = d;
  res.json(map);
});

router.put("/", async (req, res) => {
  const map = req.body || {};
  const ops = Object.entries(map).map(([exerciseId, v]) => ({
    updateOne: {
      filter: { exerciseId },
      update: { $set: { sec: v.sec || 0, reps: v.reps || 0, bestTempo: v.bestTempo || 0, done: !!v.done, exerciseId } },
      upsert: true
    }
  }));
  if (ops.length) await ProgressLog.bulkWrite(ops);
  res.json({ ok: true, count: ops.length });
});

export default router;
