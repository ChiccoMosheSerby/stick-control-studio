import { useState } from "react";
import { useAuth } from "../lib/auth.jsx";
import { api } from "../api.js";

const C = { bg: "#14110F", panel: "#1F1A17", border: "#2E2825", text: "#EDE6DD", muted: "#8A7E73", R: "#E8A33D", ok: "#6FBF73", err: "#E07A5F" };

const st = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.text, padding: 20 },
  card: { width: "100%", maxWidth: 380, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28 },
  brand: { fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: C.muted, marginBottom: 6 },
  title: { fontSize: 22, fontWeight: 700, margin: "0 0 18px" },
  label: { display: "block", fontSize: 12, color: C.muted, margin: "0 0 6px" },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 15, marginBottom: 14, outline: "none" },
  btn: { width: "100%", padding: "12px", borderRadius: 10, border: 0, background: C.R, color: C.bg, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  link: { background: "none", border: 0, color: C.muted, cursor: "pointer", fontSize: 13, padding: 4 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 },
  msg: (c) => ({ fontSize: 13, color: c, margin: "0 0 12px" })
};

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");   // 'login' | 'register' | 'forgot'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setInfo(""); setBusy(true);
    try {
      if (mode === "login") await login(email, password, remember);
      else if (mode === "register") await register(email, password, remember);
      else { const r = await api.forgotPassword(email); setInfo(r.message || "If that email has an account, a reset link is on its way."); }
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }

  const swap = (m) => { setMode(m); setErr(""); setInfo(""); };

  return (
    <div style={st.wrap}>
      <form style={st.card} onSubmit={submit}>
        <img src="/logo.png" alt="" width={72} height={61} style={{ display: "block", margin: "0 auto 8px" }} />
        <div style={st.brand}>Stick Control · Studio</div>
        <h1 style={st.title}>
          {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset password"}
        </h1>

        {err && <div style={st.msg(C.err)}>{err}</div>}
        {info && <div style={st.msg(C.ok)}>{info}</div>}

        <label style={st.label}>Email</label>
        <input style={st.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        {mode !== "forgot" && (<>
          <label style={st.label}>Password</label>
          <input style={st.input} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted, cursor: "pointer", marginBottom: 4 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device
          </label>
        </>)}

        <button style={st.btn} type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Email me a reset link"}
        </button>

        <div style={st.row}>
          <button type="button" style={st.link} onClick={() => swap(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create an account" : "Have an account? Sign in"}
          </button>
          {mode !== "forgot"
            ? <button type="button" style={st.link} onClick={() => swap("forgot")}>Forgot password?</button>
            : <button type="button" style={st.link} onClick={() => swap("login")}>Back to sign in</button>}
        </div>
      </form>
    </div>
  );
}
