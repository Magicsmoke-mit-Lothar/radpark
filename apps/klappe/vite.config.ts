import { defineConfig } from "vite";

// Die fertige Seite liegt auf dem Server unter /klappe/ (siehe deploy/Caddyfile)
export default defineConfig({
  base: "/klappe/",
  server: { port: 5175 },
});
