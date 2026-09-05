import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El puerto es fijo porque tauri.conf.json apunta a el en devUrl.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
