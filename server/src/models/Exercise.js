import mongoose from "mongoose";

// Rhythm model (BUILD_SPEC §3/§8): measures -> voices -> events. Durations carry the
// timing; x is an optional visual hint (may be null -> placed structurally).
const EventSchema = new mongoose.Schema({
  type: { type: String, default: "note" },   // "note" | "rest"
  value: { type: String },                    // whole | half | quarter | eighth | 16th | 32nd | 64th
  dots: { type: Number, default: 0 },
  tuplet: { type: mongoose.Schema.Types.Mixed, default: null },   // {n, of} | null
  dur: { type: Number },                      // optional explicit duration (q); else derived
  hand: { type: String, default: null },      // "R" | "L" | null
  x: { type: Number, default: null },         // [0,1] optional dot position
  tie: { type: Boolean, default: false }
}, { _id: false });

const VoiceSchema = new mongoose.Schema({
  inst: { type: String, default: "snare" },
  stem: { type: String, default: "up" },
  events: { type: [EventSchema], default: [] }
}, { _id: false });

const MeasureSchema = new mongoose.Schema({
  voices: { type: [VoiceSchema], default: [] }
}, { _id: false });

const ExerciseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  img: { type: String, required: true },  // dataURL of the deskewed/cropped image
  noteY: { type: Number, default: 0.5 },
  aligned: { type: Boolean, default: false },
  timeSig: { type: String, default: "¢" },        // display glyph
  time: { type: mongoose.Schema.Types.Mixed, default: { num: 2, den: 2 } },  // machine meter {num,den}
  meter: { type: String, default: "cut time (2/2)" },
  noteValue: { type: String, default: "eighth notes" },
  measureBeats: { type: Number, default: 4 },
  measures: { type: [MeasureSchema], default: [] },
  beats: { type: mongoose.Schema.Types.Mixed, default: undefined }  // legacy; kept so old docs don't error
}, { timestamps: true });

export default mongoose.model("Exercise", ExerciseSchema);
