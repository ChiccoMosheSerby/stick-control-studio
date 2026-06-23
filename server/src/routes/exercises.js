import { Router } from "express";
import Exercise from "../models/Exercise.js";

const router = Router();

router.get("/", async (_req, res) => {
  const list = await Exercise.find().sort({ createdAt: 1 }).lean();
  res.json(list);
});

router.post("/", async (req, res) => {
  try {
    const doc = await Exercise.findOneAndUpdate(
      { id: req.body.id }, req.body,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(doc);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete("/", async (_req, res) => { await Exercise.deleteMany({}); res.json({ ok: true }); });
router.delete("/:id", async (req, res) => { await Exercise.deleteOne({ id: req.params.id }); res.json({ ok: true }); });

export default router;
