import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1234,
    proxy: { "/api": "http://localhost:2345" }   // forward API calls to the Express server
  }
});
