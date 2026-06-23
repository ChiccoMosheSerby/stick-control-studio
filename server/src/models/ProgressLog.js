import mongoose from "mongoose";

const ProgressSchema = new mongoose.Schema({
  exerciseId: { type: String, required: true, unique: true, index: true },
  sec: { type: Number, default: 0 },
  reps: { type: Number, default: 0 },
  bestTempo: { type: Number, default: 0 },
  done: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model("ProgressLog", ProgressSchema);
