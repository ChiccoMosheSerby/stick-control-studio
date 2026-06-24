// Thin wrapper around the backend API.
// Exercises are now STATIC: pre-cut from the book and shipped as client assets
// (client/public/exercises/). Only progress is dynamic (per-user, in the DB).
// Dev: VITE_API_URL is empty and Vite proxies /api -> the local Express server.
// Prod: set VITE_API_URL to the deployed API origin.
const BASE = import.meta.env.VITE_API_URL ?? "";
const J = { "Content-Type": "application/json" };

export const api = {
  // Static manifest, bundled with the client (served from /public, copied to /dist on build).
  // Fetched relative to the client origin, not the API origin.
  async getExercises() {
    const r = await fetch(`/exercises/exercises.json`, { cache: "no-cache" });
    return r.ok ? r.json() : [];
  },
  async getProgress() {
    const r = await fetch(`${BASE}/api/progress`);
    return r.ok ? r.json() : {};
  },
  async saveProgress(map) {
    await fetch(`${BASE}/api/progress`, { method: "PUT", headers: J, body: JSON.stringify(map) });
  }
};
