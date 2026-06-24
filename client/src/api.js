// Thin API wrapper. Stores the JWT in localStorage and attaches it to /api calls.
// Exercises are STATIC client assets (client/public/exercises/); everything else
// (auth, per-user progress) goes to the Express API.
// Dev: VITE_API_URL is empty and Vite proxies /api -> the local Express server.
// Prod: set VITE_API_URL to the deployed API origin (same origin in single-service deploy).
const BASE = import.meta.env.VITE_API_URL ?? "";
const TOKEN_KEY = "stickcontrol:token";

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

  // per-user progress (requires auth).
  getProgress: () => request("GET", "/progress"),
  saveProgress: (map) => request("PUT", "/progress", map),
  resetProgress: () => request("DELETE", "/progress")
};
