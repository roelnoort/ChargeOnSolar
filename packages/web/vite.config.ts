import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: server,
        // Pass Server-Sent Events through as they arrive, not buffered.
        configure: (proxy) => {
          proxy.on("proxyRes", (response) => {
            if (
              response.headers["content-type"]?.includes("text/event-stream")
            ) {
              response.headers["cache-control"] = "no-cache";
              response.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
