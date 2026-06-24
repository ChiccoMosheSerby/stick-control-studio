import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, setToken } from "../api.js";

const C = { bg: "#14110F", panel: "#1F1A17", border: "#2E2825", text: "#EDE6DD", muted: "#8A7E73", R: "#E8A33D", ok: "#6FBF73", err: "#E07A5F" };
const st = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.text, padding: 20 },
  card: { width: "100%", maxWidth: 380, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28 },
  title: { fontSize: 22, fontWeight: 700, margin: "0 0 18px" },
  label: { display: "block", fontSize: 12, color: C.muted, margin: "0 0 6px" },
  input: { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 15, marginBottom: 14, outline: "none" },
  btn: { width: "100%", padding: "12px", borderRadius: 10, border: 0, background: C.R, color: C.bg, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  msg: (c) => ({ fontSize: 13, color: c, margin: "0 0 12px" })
};

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api.resetPassword(token, password);
      setToken(r.token);              // signs the user in with the fresh token
      window.location.replace("/");   // reload so AuthProvider picks up the session
    } catch (e2) { setErr(e2.message); setBusy(false); }
  }

  if (!token) return (
    <div style={st.wrap}><div style={st.card}>
      <h1 style={st.title}>Invalid link</h1>
      <div style={st.msg(C.err)}>This reset link is missing its token.</div>
      <button style={st.btn} onClick={() => nav("/")}>Back to sign in</button>
    </div></div>
  );

  return (
    <div style={st.wrap}>
      <form style={st.card} onSubmit={submit}>
        <h1 style={st.title}>Set a new password</h1>
        {err && <div style={st.msg(C.err)}>{err}</div>}
        <label style={st.label}>New password</label>
        <input style={st.input} type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        <button style={st.btn} type="submit" disabled={busy}>{busy ? "…" : "Reset password"}</button>
      </form>
    </div>
  );
}
