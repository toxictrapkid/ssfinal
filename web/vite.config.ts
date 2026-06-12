import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // convex lives in the repo-root node_modules (one copy shared with the
    // backend codegen); force its react peer-dep onto OUR react instance
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    fs: {
      // convex/_generated lives one level above the vite root
      allow: [".."],
    },
  },
});
