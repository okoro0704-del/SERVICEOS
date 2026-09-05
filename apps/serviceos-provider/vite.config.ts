import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "ServiceOS Provider",
        short_name: "Provider",
        description: "At-home provider console for ServiceOS",
        theme_color: "#042f2e",
        background_color: "#042f2e",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
  server: {
    port: 5194,
    proxy: {
      "/v1": "http://localhost:8920",
      "/health": "http://localhost:8920",
    },
  },
});
