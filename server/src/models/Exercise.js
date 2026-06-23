import mongoose from "mongoose";

const NoteSchema = new mongoose.Schema({
  x: { type: Number, default: null },     // [0,1] horizontal position; null = no dot
  h: { type: String, default: null },     // "R" | "L" | null
  rest: { type: Boolean, default: false }
}, { _id: false });

const BeatSchema = new mongoose.Schema({
  sub: { type: Number, required: true },  // 1=whole 2=eighths 3=triplet 4=16ths
  notes: { type: [NoteSchema], default: [] }
}, { _id: false });

const ExerciseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  img: { type: String, required: true },  // dataURL of the deskewed/cropped image
  noteY: { type: Number, default: 0.5 },
  aligned: { type: Boolean, default: false },
  timeSig: { type: String, default: "¢" },
  meter: { type: String, default: "cut time (2/2)" },
  noteValue: { type: String, default: "eighth notes" },
  measureBeats: { type: Number, default: 4 },
  beats: { type: [BeatSchema], default: [] }
}, { timestamps: true });

export default mongoose.model("Exercise", ExerciseSchema);
