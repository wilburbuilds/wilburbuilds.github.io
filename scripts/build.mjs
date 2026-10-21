// Build: Obsidian notes with `publish: true` -> static HTML in ./dist, leak-scanned, then backed up.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { ROOT, loadConfig, collectNotes, makeResolver, cleanObsidian, isPublished, MONTHS, esc } from "./lib.mjs";
import { scan, report } from "./scan.mjs";

const marked = new Marked({ gfm: true, breaks: false });

const page = (cfg, { title, body, depth, cls = "", description }) => {
  const up = depth ? "../".repeat(depth) : "./";
  const nav = cfg.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || cfg.description || cfg.name)}">
<link rel="stylesheet" href="${up}site.css">${cfg.siteUrl ? `\n<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="${up}rss.xml">` : ""}
</head>
<body class="${cls}">
<header class="site-header">
<${depth ? "div" : "h1"} class="name"><a href="${up}">${esc(cfg.name)}</a></${depth ? "div" : "h1"}>
<nav>${nav}</nav>
</header>
<main>
${body}
</main>
</body>
</html>
`;
};

const fmtDate = (d, withYear) => `${MONTHS[d.mo - 1]} ${d.d}${withYear ? ", " + d.y : ""}`;

export function build({ quiet = false } = {}) {
  const t0 = performance.now();
  const log = (...a) => !quiet && console.log(...a);
  const cfg = loadConfig();

  // 1. Pick source: the Obsidian writing folder, or the in-repo sample if it has nothing published.
  let src = collectNotes(cfg.sourceDir);
  let sourceDir = cfg.sourceDir, usingSample = false;
  if (src.published.length === 0) {
    log(src.missing ? `Source folder not found (${cfg.sourceDir}); using sample content.` : `No notes with publish: true in source (${src.skipped} unpublished); using sample content.`);
    src = collectNotes(cfg.sampleDir);
    sourceDir = cfg.sampleDir;
    usingSample = true;
  }
  const notes = src.published;

  // 2. Guard: every note that reaches the renderer must have publish: true.
  for (const n of notes) {
    if (!isPublished(n.data)) throw new Error(`Refusing to build: ${n.rel} lacks publish: true`);
  }
  const slugs = new Map();
  for (const n of notes) {
    if (slugs.has(n.slug)) throw new Error(`Duplicate slug "${n.slug}": ${slugs.get(n.slug)} and ${n.rel}`);
    slugs.set(n.slug, n.rel);
    if (n.date.guessed) log(`  ! ${n.rel}: no date in frontmatter, using file date ${n.date.iso}`);
  }

  // 3. Render into a temp dir; only swap into ./dist if the leak scan passes.
  const out = path.join(ROOT, ".dist-tmp");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets/site.css"), path.join(out, "site.css"));
  fs.writeFileSync(path.join(out, ".nojekyll"), "");

  const resolve = makeResolver(notes);
  for (const n of notes) {
    if (!isPublished(n.data)) throw new Error(`Refusing to render ${n.rel}: lacks publish: true`);
    const md = cleanObsidian(n.body, { resolve, hrefFor: (m) => `../${m.slug}/`, warn: (w) => log(`  · ${n.rel}: ${w}`) });
    const html = marked.parse(md);
    const body = `<article class="article">
<h1>${esc(n.title)}</h1>
<p class="date"><time datetime="${n.date.iso}">${fmtDate(n.date, true)}</time></p>
${html}
</article>
<footer class="site-footer"><a href="../../">← ${esc(cfg.name)}</a><span></span></footer>`;
    const dir = path.join(out, "writing", n.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), page(cfg, { title: `${n.title} · ${cfg.name}`, body, depth: 2, cls: "post", description: n.description }));
  }

  // Home page.
  const byYear = new Map();
  for (const n of notes) (byYear.get(n.date.y) || byYear.set(n.date.y, []).get(n.date.y)).push(n);
  const years = [...byYear.keys()].sort((a, b) => b - a).map((y) => `<section class="year">
<h3>${y}</h3>
<ul>
${byYear.get(y).map((n) => `<li><a href="writing/${n.slug}/">${esc(n.title)}</a><time datetime="${n.date.iso}">${fmtDate(n.date)}</time></li>`).join("\n")}
</ul>
</section>`).join("\n");
  const notesBlock = cfg.notes.length ? `<h2>${esc(cfg.notesHeading || "Notes")}</h2>\n<ul class="notes">\n${cfg.notes.map((x) => typeof x === "string" ? `<li>${esc(x)}</li>` : `<li>${esc(x.text || "")}<a href="${esc(x.href)}">${esc(x.link)}</a>${esc(x.after || "")}</li>`).join("\n")}\n</ul>` : "";
  const home = `<h2>About me</h2>
<p>${esc(cfg.about)}</p>
${notesBlock}
<section class="writing">
<h2>Writing</h2>
${years || "<p>Nothing yet.</p>"}
</section>`;
  fs.writeFileSync(path.join(out, "index.html"), page(cfg, { title: cfg.name, body: home, depth: 0, cls: "home" }));
  fs.writeFileSync(path.join(out, "404.html"), page(cfg, { title: `Not found · ${cfg.name}`, body: `<h1>Not found</h1><p><a href="/">Home</a></p>`, depth: 0 }).replace('href="./site.css"', 'href="/site.css"'));

  if (cfg.siteUrl) {
    const base = cfg.siteUrl.replace(/\/+$/, "");
    const items = notes.map((n) => `<item><title>${esc(n.title)}</title><link>${base}/writing/${n.slug}/</link><guid>${base}/writing/${n.slug}/</guid><pubDate>${new Date(n.date.iso + "T12:00:00Z").toUTCString()}</pubDate>${n.description ? `<description>${esc(n.description)}</description>` : ""}</item>`).join("\n");
    fs.writeFileSync(path.join(out, "rss.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(cfg.name)}</title><link>${base}/</link><description>${esc(cfg.description || cfg.name)}</description>\n${items}\n</channel></rss>\n`);
  }

  // 4. Cross-check output against the published set, then leak scan.
  const postDirs = fs.readdirSync(path.join(out, "writing"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (JSON.stringify(postDirs) !== JSON.stringify([...slugs.keys()].sort())) throw new Error("Output posts do not match published notes");
  const findings = scan(out, cfg);
  if (findings.length) {
    console.error(`Leak scan FAILED (${findings.length}). Nothing written to dist/.`);
    report(findings);
    fs.rmSync(out, { recursive: true, force: true });
    const e = new Error("leak scan failed"); e.findings = findings; throw e;
  }
  const dist = path.join(ROOT, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.renameSync(out, dist);

  // 5. Backup: published source markdown + dist, timestamped; keep the newest N.
  const backup = backupRun(cfg, sourceDir, notes.map((n) => n.rel));
  const ms = Math.round(performance.now() - t0);
  log(`Built ${notes.length} post(s)${usingSample ? " from SAMPLE content" : ""} → dist/ (${src.skipped} unpublished skipped). Leak scan passed. ${ms} ms`);
  log(`Backup: ${backup}`);
  return { notes, usingSample, ms, backup };
}

function backupRun(cfg, sourceDir, rels) {
  fs.mkdirSync(cfg.backupDir, { recursive: true, mode: 0o700 });
  const d = new Date(), z = (x) => String(x).padStart(2, "0");
  const ts = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; // local time
  const file = path.join(cfg.backupDir, `site-${ts}.tar.gz`);
  const args = ["-czf", file, "-C", sourceDir, ...rels, "-C", ROOT, "dist"];
  const r = spawnSync("tar", args, { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`backup failed: ${r.stderr}`);
  fs.chmodSync(file, 0o600);
  const all = fs.readdirSync(cfg.backupDir).filter((f) => /^site-\d{8}-\d{6}\.tar\.gz$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - cfg.keepBackups))) fs.rmSync(path.join(cfg.backupDir, old));
  return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { build(); } catch (e) { if (!e.findings) console.error(e.message); process.exit(1); }
}
