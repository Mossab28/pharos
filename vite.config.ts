import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  // HTTPS only for local phone testing; production is behind Traefik TLS.
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        send: resolve(root, "send/index.html"),
        receive: resolve(root, "receive/index.html"),
      },
    },
  },
});
