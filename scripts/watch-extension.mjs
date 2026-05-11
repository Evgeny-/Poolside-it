import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const watchedPaths = ["extension", "src", "vite.config.mjs", "svelte.config.js"].map((item) => (
  path.join(rootDir, item)
));

let building = false;
let queued = false;
let debounceTimer = null;

function runBuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, ["scripts/build-extension.mjs"], {
    cwd: rootDir,
    stdio: "inherit"
  });
  child.on("exit", (code) => {
    building = false;
    if (code === 0) {
      console.log("[watch] dist/chrome rebuilt");
    } else {
      console.error(`[watch] build failed with exit code ${code}`);
    }
    if (queued) {
      queued = false;
      runBuild();
    }
  });
}

function scheduleBuild() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runBuild, 120);
}

runBuild();

for (const target of watchedPaths) {
  watch(target, { recursive: true }, scheduleBuild);
}

console.log("[watch] watching extension and Svelte source files");
