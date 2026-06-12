import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 414, height: 896 }, // mobile-first — worked from the lot
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
