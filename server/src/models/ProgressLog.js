import mongoose from "mongoose";

// Per-user, per-exercise practice progress. Unique on the (userId, exerciseId)
// pair so each user keeps independent stats for every exercise.
const ProgressSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  exerciseId: { type: String, required: true },
  sec: { type: Number, default: 0 },
  reps: { type: Number, default: 0 },
  bestTempo: { type: Number, default: 0 },
  done: { type: Boolean, default: false }
}, { timestamps: true });

ProgressSchema.index({ userId: 1, exerciseId: 1 }, { unique: true });

export default mongoose.model("ProgressLog", ProgressSchema);
