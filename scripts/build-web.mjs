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

// claude.ai-hosted edition (published with the Artifact tool): page fragment
// + bundle. Claude answers through the page's `sample` capability.
const art = path.join(root, "artifact");
fs.rmSync(art, { recursive: true, force: true });
fs.mkdirSync(art, { recursive: true });
await build({
  entryPoints: [path.join(root, "web/artifact-entry.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "safari16"],
  minify: true,
  legalComments: "eof",
  outfile: path.join(art, "app.js"),
  logLevel: "warning",
});
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>")).trim();
const css = fs.readFileSync(path.join(root, "public/style.css"), "utf8");
fs.writeFileSync(
  path.join(art, "index.html"),
  `<title>Nigat Voice Coach</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>\n${css}</style>\n${body}\n`,
);
console.log("Built claude.ai edition into artifact/");
