// Builds dist/ringlight-chrome-<version>.zip, ready for the Chrome Web Store
// or for "Load unpacked" after extracting it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "scripts", "sync-extension.mjs")], { stdio: "inherit" });

const ext = join(root, "extension");
const { version } = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
const dist = join(root, "dist");
const zip = join(dist, `ringlight-chrome-${version}.zip`);
mkdirSync(dist, { recursive: true });
rmSync(zip, { force: true });

// bsdtar (built into Windows 10+ and macOS) writes zip files with -a. On
// Windows, call it by path: Git Bash puts GNU tar first, which can't.
const tar = process.platform === "win32" ? join(process.env.SystemRoot, "System32", "tar.exe") : "tar";
execFileSync(tar, ["-a", "-c", "-f", zip, "manifest.json", "_locales", "background.js", "content", "icons", "ui"], {
  cwd: ext,
  stdio: "inherit",
});
console.log(`Packed ${zip}`);
