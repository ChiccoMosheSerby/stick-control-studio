import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { measureIsComplete } from "../lib/rhythm.js";
import { detectNoteheads } from "../lib/detect.js";

const router = Router();
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

// §3 response schema — note values, dots, tuplets, rests, R/L hand. Strict: every
// object closed (additionalProperties:false) with all keys required.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    time: {
      type: "object", additionalProperties: false,
      properties: { num: { type: "integer" }, den: { type: "integer" } },
      required: ["num", "den"]
    },
    measures: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          events: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["note", "rest"] },
                value: { type: "string", enum: ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"] },
                dots: { type: "integer" },
                tuplet: {
                  anyOf: [
                    { type: "null" },
                    { type: "object", additionalProperties: false, properties: { n: { type: "integer" }, of: { type: "integer" } }, required: ["n", "of"] }
                  ]
                },
                hand: { anyOf: [{ type: "null" }, { type: "string", enum: ["R", "L", "F"] }] }
              },
              required: ["type", "value", "dots", "tuplet", "hand"]
            }
          }
        },
        required: ["events"]
      }
    }
  },
  required: ["time", "measures"]
};

const PROMPT = `You are reading one line of snare-drum notation. Return STRICT JSON only, no prose, matching:
{ "time": {"num":N,"den":N}, "measures": [ { "events": [ {"type":"note|rest","value":"whole|half|quarter|eighth|16th|32nd","dots":0,"tuplet":null,"hand":"R|L|F|null"} ] } ] }
Rules: beam/flag count gives the value (1=eighth, 2=16th, 3=32nd). A bracketed "3" = triplet {"n":3,"of":2}. Read dots and rests. Read the sticking letter under each note as hand: "R" right, "L" left, and "F" for a flam (an "F" letter, often circled, with a small grace note before the main note). The "¢" glyph = cut time {"num":2,"den":2}. Each measure's durations must fill the measure exactly.`;

const imgBlock = (data, media) => ({ type: "image", source: { type: "base64", media_type: media, data } });
const txtBlock = { type: "text", text: PROMPT };
const stripFences = (s) => s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

// Try strict structured output, then forced tool-use, then prose JSON. Any one that
// yields parseable {time, measures} wins; we never debug a failing strategy, we fall through.
async function readNotation(client, content) {
  // (1) structured output
  try {
    const r = await client.messages.create({
      model: MODEL, max_tokens: 4096, messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } }
    });
    const t = r.content.find((b) => b.type === "text");
    if (t) return JSON.parse(t.text);
  } catch (e) { console.warn("read: structured-output path failed, falling through:", e.message); }

  // (2) forced tool use — tool_use.input is guaranteed schema-shaped
  try {
    const r = await client.messages.create({
      model: MODEL, max_tokens: 4096, messages: [{ role: "user", content }],
      tools: [{ name: "emit_notation", description: "Emit the read snare-drum notation as structured JSON.", input_schema: SCHEMA, strict: true }],
      tool_choice: { type: "tool", name: "emit_notation" }
    });
    const tu = r.content.find((b) => b.type === "tool_use");
    if (tu) return tu.input;
  } catch (e) { console.warn("read: tool-use path failed, falling through:", e.message); }

  // (3) plain prose JSON
  const r = await client.messages.create({ model: MODEL, max_tokens: 4096, messages: [{ role: "user", content }] });
  const t = r.content.find((b) => b.type === "text");
  return JSON.parse(stripFences(t.text));
}

router.post("/", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "vision not configured" });
  const { imageB64, mediaType } = req.body || {};
  if (!imageB64) return res.status(400).json({ error: "imageB64 required" });
  const media = mediaType || "image/png";

  try {
    const client = new Anthropic();
    const data = await readNotation(client, [imgBlock(imageB64, media), txtBlock]);
    const time = data.time || { num: 4, den: 4 };
    const measures = data.measures || [];
    const aligned = measures.length > 0 && measures.every((m) => measureIsComplete(m.events, time));
    // Deterministic notehead positions on the same (cleaned) image — no per-import variance.
    const { notes, noteY } = detectNoteheads(Buffer.from(imageB64, "base64"));
    res.json({ time, measures, aligned, notes, noteY });
  } catch (e) {
    console.error("read failed:", e.message);
    res.status(502).json({ error: "vision read failed: " + e.message });
  }
});

export default router;
