// Builds the phone version (no server needed) into ./docs for GitHub Pages.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "web/entry.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "safari16"],
  minify: true,
  legalComments: "eof",
  outfile: path.join(out, "app.js"),
  logLevel: "warning",
});

for (const f of ["index.html", "style.css", "icon.svg", "manifest.webmanifest", "sw.js"]) {
  fs.copyFileSync(path.join(root, "public", f), path.join(out, f));
}
fs.writeFileSync(path.join(out, ".nojekyll"), ""); // serve files as-is
console.log("Built phone version into docs/");
