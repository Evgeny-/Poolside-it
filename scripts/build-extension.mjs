import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, "dist/chrome");
const extensionDir = path.join(rootDir, "extension");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await Promise.all([
  cp(path.join(extensionDir, "manifest.json"), path.join(distDir, "manifest.json")),
  cp(path.join(extensionDir, "service-worker.js"), path.join(distDir, "service-worker.js")),
  cp(path.join(extensionDir, "assets"), path.join(distDir, "assets"), { recursive: true }),
  cp(path.join(extensionDir, "shared"), path.join(distDir, "shared"), { recursive: true }),
  cp(path.join(extensionDir, "model"), path.join(distDir, "model"), { recursive: true }),
  cp(path.join(extensionDir, "content"), path.join(distDir, "content"), { recursive: true })
]);

await build({
  configFile: path.join(rootDir, "vite.config.mjs")
});
