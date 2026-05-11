import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactSnapshot } from "../extension/model/agent.js";

const [, , inputDirArg, outputDirArg] = process.argv;

if (!inputDirArg || !outputDirArg) {
  console.error("Usage: node scripts/generate-compact-snapshots.mjs <input-dir> <output-dir>");
  process.exit(1);
}

const inputDir = path.resolve(inputDirArg);
const outputDir = path.resolve(outputDirArg);
const entries = await readdir(inputDir, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

await mkdir(outputDir, { recursive: true });

for (const file of files) {
  const sourcePath = path.join(inputDir, file);
  const outputPath = path.join(outputDir, file);
  const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
  const compact = compactSnapshot(snapshot);
  await writeFile(outputPath, `${JSON.stringify(compact, null, 2)}\n`, "utf8");
}

console.log(`Generated ${files.length} compact snapshots in ${outputDir}`);
