import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:5174",
        changeOrigin: true,
      },
    },
    // Tailscale DNS name will hit this server; allow it explicitly.
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "@server/types": path.resolve(__dirname, "../src/server/types.ts"),
    },
  },
});
