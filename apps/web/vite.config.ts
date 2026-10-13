import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  // The GitHub zip route lives in the Worker (`src/api/`): run
  // `pnpm --filter web dev:worker` beside `dev` to load repositories from GitHub.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
