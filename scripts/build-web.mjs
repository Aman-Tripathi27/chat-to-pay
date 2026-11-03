// Builds the single-file web app: bundles web/app.ts (and the order reader it imports)
// and inlines it into web/index.html.
//
//   web/dist/index.html     a complete page, ready for any static host
//   web/dist/fragment.html  the same page without <html>/<head>, for hosts that add their own

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const MARKER = "<!-- app-script -->";

const [output] = await build({
  root,
  configFile: false,
  logLevel: "warn",
  build: {
    write: false,
    minify: true,
    target: "es2020",
    lib: { entry: "web/app.ts", formats: ["iife"], name: "ChatToPay", fileName: () => "app.js" },
  },
});

const code = output.output.find((chunk) => chunk.type === "chunk").code.replace(/<\/script/gi, "<\\/script");
const template = await readFile(`${root}web/index.html`, "utf8");
if (!template.includes(MARKER)) throw new Error(`web/index.html is missing ${MARKER}`);

const fragment = template.replace(MARKER, () => `<script>\n${code}</script>`);
const styleEnd = fragment.indexOf("</style>") + "</style>".length;
const head = fragment.slice(0, styleEnd);
const body = fragment.slice(styleEnd).trim();
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body>
${body}
</body>
</html>
`;

await mkdir(`${root}web/dist`, { recursive: true });
await writeFile(`${root}web/dist/fragment.html`, fragment);
await writeFile(`${root}web/dist/index.html`, page);
console.log(
  `web/dist/index.html  ${(page.length / 1024).toFixed(1)} kB (script ${(code.length / 1024).toFixed(1)} kB)`,
);
