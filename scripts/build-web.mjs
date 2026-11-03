// Builds the single-file web app: bundles web/app.ts (and the order reader it imports)
// and inlines it into web/index.html.
//
//   web/dist/index.html     a complete page, ready for any static host (with web/public beside it)
//   web/dist/fragment.html  the same page without <html>/<head>, for hosts that add their own

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const MARKER = "<!-- app-script -->";
const SITE = "https://chat-to-pay.netlify.app";
const TITLE = "Chat-to-Pay: turn a chat into a payment";
const DESCRIPTION =
  "Paste a WhatsApp or Instagram order chat and get a checked order, a payment link and a reply in the customer's language. Reads English, Hinglish and Hindi, right in your browser.";

// Search and link-preview tags, for the standalone page only.
const META = `<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="#f5f5f7">
<link rel="canonical" href="${SITE}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/">
<meta property="og:site_name" content="Chat-to-Pay">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A customer's Hinglish chat on a phone, beside the order read from it: ₹1,947, payment link ready">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="${SITE}/og.png">`;

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
${META}
${head}
</head>
<body>
${body}
</body>
</html>
`;

await mkdir(`${root}web/dist`, { recursive: true });
await cp(`${root}web/public`, `${root}web/dist`, { recursive: true });
await writeFile(`${root}web/dist/fragment.html`, fragment);
await writeFile(`${root}web/dist/index.html`, page);
console.log(
  `web/dist/index.html  ${(page.length / 1024).toFixed(1)} kB (script ${(code.length / 1024).toFixed(1)} kB)`,
);
