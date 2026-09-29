// Wraps app/keel.html (the same file that runs as a claude.ai artifact)
// into public/index.html with the head an installable home screen app needs.
import { readFileSync, writeFileSync } from "node:fs";

const body = readFileSync(new URL("../app/keel.html", import.meta.url), "utf8");
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F5F5F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Keel">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<style>
:root { color-scheme: light dark; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); -webkit-text-size-adjust: 100%; }
html, body { margin: 0; }
img { max-width: 100%; }
[hidden] { display: none !important; }
button, input, select, textarea { -webkit-tap-highlight-color: transparent; }
</style>
</head>
<body>
`;
const tail = `
<script>
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
</script>
</body>
</html>
`;
writeFileSync(new URL("../public/index.html", import.meta.url), head + body + tail);
console.log("Built public/index.html");
