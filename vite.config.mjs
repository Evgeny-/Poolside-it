import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pageRoot = path.resolve(rootDir, "src/pages");

export default defineConfig({
  root: pageRoot,
  base: "./",
  publicDir: false,
  plugins: [
    svelte({
      configFile: path.resolve(rootDir, "svelte.config.js")
    }),
    tailwindcss()
  ],
  resolve: {
    alias: {
      $lib: path.resolve(rootDir, "src/lib"),
      $extension: path.resolve(rootDir, "extension")
    }
  },
  build: {
    outDir: path.resolve(rootDir, "dist/chrome"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(pageRoot, "sidepanel.html"),
        trace: path.resolve(pageRoot, "trace.html"),
        "playground/index": path.resolve(pageRoot, "playground/index.html"),
        "playground/contact": path.resolve(pageRoot, "playground/contact.html"),
        "playground/compose": path.resolve(pageRoot, "playground/compose.html"),
        "playground/dynamic": path.resolve(pageRoot, "playground/dynamic.html"),
        "playground/ambiguous": path.resolve(pageRoot, "playground/ambiguous.html")
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
