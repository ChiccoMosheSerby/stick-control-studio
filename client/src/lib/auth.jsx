import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken, setVisitor, isVisitor } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Resume a session on load: a guest (no account) is purely local; otherwise resume
  // from a stored token.
  useEffect(() => {
    if (isVisitor()) { setUser({ visitor: true, email: null }); setLoading(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password, remember = true) {
    const r = await api.login(email, password, remember);
    setVisitor(false); setToken(r.token, remember); setUser(r.user);
  }
  async function register(email, password, remember = true) {
    const r = await api.register(email, password, remember);   // open registration -> immediate sign-in
    setVisitor(false); setToken(r.token, remember); setUser(r.user);
  }
  function loginVisitor() {   // no email/password, no server — progress stays on this device
    setToken(null); setVisitor(true); setUser({ visitor: true, email: null });
  }
  function logout() {
    setToken(null); setVisitor(false); setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginVisitor, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
