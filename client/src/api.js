// Thin wrapper around the backend API.
// Dev: VITE_API_URL is empty and Vite proxies /api -> the local Express server.
// Prod: set VITE_API_URL to the deployed API origin (e.g. https://stick-control-studio.onrender.com).
const BASE = import.meta.env.VITE_API_URL ?? "";
const J = { "Content-Type": "application/json" };

export const api = {
  async getExercises() {
    const r = await fetch(`${BASE}/api/exercises`);
    return r.ok ? r.json() : [];
  },
  async addExercise(ex) {
    const r = await fetch(`${BASE}/api/exercises`, { method: "POST", headers: J, body: JSON.stringify(ex) });
    return r.ok ? r.json() : null;
  },
  async clearExercises() {
    await fetch(`${BASE}/api/exercises`, { method: "DELETE" });
  },
  async getProgress() {
    const r = await fetch(`${BASE}/api/progress`);
    return r.ok ? r.json() : {};
  },
  async saveProgress(map) {
    await fetch(`${BASE}/api/progress`, { method: "PUT", headers: J, body: JSON.stringify(map) });
  }
};
