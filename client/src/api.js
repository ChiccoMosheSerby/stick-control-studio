// Thin API wrapper. Stores the JWT in localStorage and attaches it to /api calls.
// Exercises are STATIC client assets (client/public/exercises/); everything else
// (auth, per-user progress) goes to the Express API.
// Dev: VITE_API_URL is empty and Vite proxies /api -> the local Express server.
// Prod: set VITE_API_URL to the deployed API origin (same origin in single-service deploy).
const BASE = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "stickcontrol:token";
const VISITOR_KEY = "stickcontrol:visitor";
const GUEST_PROGRESS_KEY = "stickcontrol:guestProgress";

// Visitor (guest) mode: no account, no server, no DB. Progress lives in localStorage on
// this device only. The flag is persisted so a guest stays signed in across reloads.
export function isVisitor() { try { return localStorage.getItem(VISITOR_KEY) === "1"; } catch { return false; } }
export function setVisitor(on) { try { on ? localStorage.setItem(VISITOR_KEY, "1") : localStorage.removeItem(VISITOR_KEY); } catch {} }
const loadGuestProgress = () => { try { return JSON.parse(localStorage.getItem(GUEST_PROGRESS_KEY)) || {}; } catch { return {}; } };
const saveGuestProgress = (map) => { try { localStorage.setItem(GUEST_PROGRESS_KEY, JSON.stringify(map || {})); } catch {} return { ok: true }; };
const clearGuestProgress = () => { try { localStorage.removeItem(GUEST_PROGRESS_KEY); } catch {} return { ok: true }; };

// "Remember me" -> localStorage (survives browser restart).
// Otherwise -> sessionStorage (cleared when the browser/tab closes).
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t, remember = true) {
  try {
    localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch {}
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) setToken(null);   // stale/invalid token -> sign out
    throw new Error(data.error || "Request failed");
  }
  return data;
}

export const api = {
  // auth
  register: (email, password, remember) => request("POST", "/auth/register", { email, password, remember }),
  login: (email, password, remember) => request("POST", "/auth/login", { email, password, remember }),
  me: () => request("GET", "/auth/me"),
  forgotPassword: (email) => request("POST", "/auth/forgot-password", { email }),
  resetPassword: (token, password) => request("POST", "/auth/reset-password", { token, password }),

  // exercises — static manifest bundled with the client (no auth).
  async getExercises() {
    const r = await fetch(`/exercises/exercises.json`, { cache: "no-cache" });
    return r.ok ? r.json() : [];
  },

  // per-user progress. Signed-in users hit the API; visitors read/write localStorage
  // only (nothing reaches the server/DB).
  getProgress: () => isVisitor() ? Promise.resolve(loadGuestProgress()) : request("GET", "/progress"),
  saveProgress: (map) => isVisitor() ? Promise.resolve(saveGuestProgress(map)) : request("PUT", "/progress", map),
  resetProgress: () => isVisitor() ? Promise.resolve(clearGuestProgress()) : request("DELETE", "/progress")
};
