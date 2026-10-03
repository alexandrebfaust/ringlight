// Copies the UI shared with the desktop app from src/ into extension/ui/.
// A Chrome extension can only load files inside its own folder, so the copies
// are committed; run this (npm run extension:sync) after changing src/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "backend.js",
  "common.js",
  "i18n.js",
  "paint.js",
  "ring.css",
  "app.js",
  "index.html",
  "style.css",
  "flyout.js",
  "flyout.html",
  "flyout.css",
];

const note = (file) => `Generated from src/${file} by scripts/sync-extension.mjs. Edit the original.`;
const stamp = {
  ".js": (text, file) => `// ${note(file)}\n${text}`,
  ".css": (text, file) => `/* ${note(file)} */\n${text}`,
  ".html": (text, file) => text.replace(/^(<!doctype html>\r?\n)/i, `$1<!-- ${note(file)} -->\n`),
};

const out = join(root, "extension", "ui");
mkdirSync(out, { recursive: true });
for (const file of FILES) {
  const text = readFileSync(join(root, "src", file), "utf8");
  writeFileSync(join(out, file), stamp[extname(file)](text, file));
}
console.log(`Copied ${FILES.length} files to extension/ui/`);
