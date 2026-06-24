import { createContext, useContext, useEffect, useState } from "react";
import { api, setToken } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Resume a session from a stored token on load.
  useEffect(() => {
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password, remember = true) {
    const r = await api.login(email, password, remember);
    setToken(r.token, remember); setUser(r.user);
  }
  async function register(email, password, remember = true) {
    const r = await api.register(email, password, remember);   // open registration -> immediate sign-in
    setToken(r.token, remember); setUser(r.user);
  }
  function logout() {
    setToken(null); setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
