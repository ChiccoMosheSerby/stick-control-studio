import { BrowserRouter, Routes, Route } from "react-router-dom";
import StickControlStudio from "./components/StickControlStudio.jsx";
import Admin from "./components/Admin.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StickControlStudio />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}
