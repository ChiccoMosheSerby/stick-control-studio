// Thin wrapper around the backend API. Vite proxies /api -> http://localhost:4001
const J = { "Content-Type": "application/json" };

export const api = {
  async getExercises() {
    const r = await fetch("/api/exercises");
    return r.ok ? r.json() : [];
  },
  async addExercise(ex) {
    const r = await fetch("/api/exercises", { method: "POST", headers: J, body: JSON.stringify(ex) });
    return r.ok ? r.json() : null;
  },
  async clearExercises() {
    await fetch("/api/exercises", { method: "DELETE" });
  },
  async getProgress() {
    const r = await fetch("/api/progress");
    return r.ok ? r.json() : {};
  },
  async saveProgress(map) {
    await fetch("/api/progress", { method: "PUT", headers: J, body: JSON.stringify(map) });
  }
};
