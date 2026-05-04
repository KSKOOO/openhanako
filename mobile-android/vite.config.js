import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: ["es2018", "chrome80"],
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "assets/hanako-mobile-[hash].js",
        chunkFileNames: "assets/hanako-mobile-[hash].js",
        assetFileNames: "assets/hanako-mobile-[hash][extname]"
      }
    }
  }
});
