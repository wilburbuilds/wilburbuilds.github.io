// Serve ./dist on 127.0.0.1 only. Tries the configured port, then the next 10.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig } from "./lib.mjs";

const dist = path.join(ROOT, "dist");
if (!fs.existsSync(dist)) { console.error("No dist/. Run `npm run build` first."); process.exit(1); }
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".xml": "application/xml", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(dist, p));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith("/")) { res.writeHead(301, { Location: p + "/" }).end(); return; }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": TYPES[".html"] }); fs.createReadStream(path.join(dist, "404.html")).pipe(res); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

let port = Number(process.env.PORT || loadConfig().previewPort);
const last = port + 10;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && port < last) { port++; server.listen(port, "127.0.0.1"); }
  else { console.error(e.message); process.exit(1); }
});
server.on("listening", () => console.log(`Preview: http://127.0.0.1:${port}/  (Ctrl-C to stop)`));
server.listen(port, "127.0.0.1");
