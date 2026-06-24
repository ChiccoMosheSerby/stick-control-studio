import { BrowserRouter, Routes, Route } from "react-router-dom";
import StickControlStudio from "./components/StickControlStudio.jsx";
import Admin from "./components/Admin.jsx";
import Login from "./components/Login.jsx";
import ResetPassword from "./components/ResetPassword.jsx";
import { useAuth } from "./lib/auth.jsx";

// Gate authenticated areas: show a loader while resolving the session, the
// sign-in screen when signed out, otherwise the protected page.
function Gate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#14110F", color: "#8A7E73" }}>Loading…</div>;
  if (!user) return <Login />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/" element={<Gate><StickControlStudio /></Gate>} />
        <Route path="/admin" element={<Gate><Admin /></Gate>} />
      </Routes>
    </BrowserRouter>
  );
}
