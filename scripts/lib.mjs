// Shared helpers: config, frontmatter, note collection, Obsidian clean-up.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function expandHome(p) {
  return p && p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "site.config.json"), "utf8"));
  // Machine-specific overrides (e.g. the vault path) live in an untracked file.
  const local = path.join(ROOT, "site.config.local.json");
  if (fs.existsSync(local)) Object.assign(cfg, JSON.parse(fs.readFileSync(local, "utf8")));
  cfg.sourceDir = path.resolve(ROOT, expandHome(cfg.sourceDir || "content"));
  cfg.sampleDir = path.resolve(ROOT, cfg.sampleDir || "content-sample");
  cfg.backupDir = path.resolve(expandHome(cfg.backupDir || "~/.local/share/personal-site/backups"));
  cfg.keepBackups = cfg.keepBackups ?? 20;
  cfg.previewPort = cfg.previewPort ?? 4321;
  cfg.notes = cfg.notes || [];
  cfg.links = cfg.links || [];
  return cfg;
}

// ---------- frontmatter (small YAML subset: scalars, booleans, lists) ----------
function scalar(v) {
  v = v.trim();
  if (v === "") return "";
  if (/^(true)$/i.test(v)) return true;
  if (/^(false)$/i.test(v)) return false;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map((s) => scalar(s)).filter((s) => s !== "");
  return v;
}

export function parseFrontmatter(src) {
  src = src.replace(/^\uFEFF/, "");
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: src, hasFrontmatter: false };
  const data = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s+-\s*(.*)$/) || line.match(/^-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(scalar(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\- ]+):\s*(.*)$/);
    if (kv) {
      key = kv[1].trim();
      data[key] = scalar(kv[2]);
    }
  }
  return { data, body: src.slice(m[0].length), hasFrontmatter: true };
}

// Only an unquoted YAML boolean `publish: true` counts.
export const isPublished = (data) => data && data.publish === true;

export function slugify(s) {
  return String(s)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post";
}

function walkMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue; // skip .obsidian, _drafts, _templates
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

function toDate(v, file) {
  const s = v instanceof Date ? v.toISOString() : String(v || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, y: +m[1], mo: +m[2], d: +m[3] };
  const st = fs.statSync(file);
  const dt = st.birthtime && st.birthtime.getTime() > 0 ? st.birthtime : st.mtime;
  const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { iso, y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate(), guessed: true };
}

// Read every .md under dir (read-only). Returns { published, skipped }.
export function collectNotes(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { published: [], skipped: 0, missing: true };
  const published = [];
  let skipped = 0;
  for (const file of walkMd(dir)) {
    const raw = fs.readFileSync(file, "utf8");
    const { data, body } = parseFrontmatter(raw);
    if (!isPublished(data)) { skipped++; continue; }
    const base = path.basename(file, path.extname(file));
    let title = data.title ? String(data.title) : null;
    let text = body;
    const h1 = text.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    if (!title && h1) title = h1[1];
    if (!title) title = base;
    // Drop a leading H1 that repeats the title.
    text = text.replace(/^\s*#\s+(.+?)\s*#*\s*\r?\n/, (all, t) => (t.trim() === title.trim() ? "" : all));
    published.push({
      file, rel: path.relative(dir, file), base, title,
      slug: slugify(data.slug || base),
      date: toDate(data.date, file),
      description: data.description ? String(data.description) : "",
      aliases: [].concat(data.aliases || []).map(String),
      data, body: text,
    });
  }
  published.sort((a, b) => (a.date.iso < b.date.iso ? 1 : a.date.iso > b.date.iso ? -1 : a.title.localeCompare(b.title)));
  return { published, skipped, missing: false };
}

// ---------- Obsidian -> plain Markdown ----------
// Applies fn only to prose, leaving fenced code and inline code untouched.
function mapProse(md, fn) {
  const parts = md.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.split(/(`+[^`\n]*?`+)/).map((seg, j) => (j % 2 === 1 ? seg : fn(seg))).join("");
  }).join("");
}

export function makeResolver(notes) {
  const map = new Map();
  for (const n of notes) {
    for (const k of [n.base, n.title, n.slug, n.rel.replace(/\.md$/i, ""), ...n.aliases]) map.set(k.toLowerCase(), n);
  }
  return (target) => {
    const t = decodeURIComponent(String(target)).split("#")[0].split("^")[0].trim().replace(/\.md$/i, "");
    if (!t) return null;
    return map.get(t.toLowerCase()) || map.get(path.basename(t).toLowerCase()) || null;
  };
}

export function cleanObsidian(md, { resolve, hrefFor, warn = () => {} }) {
  // Obsidian comments %% ... %% (can span lines).
  md = md.replace(/%%[\s\S]*?%%/g, "");
  return mapProse(md, (s) => {
    // Embeds ![[file]] — never pulled in.
    s = s.replace(/!\[\[[^\]\n]*\]\]/g, (m) => { warn(`dropped embed ${m}`); return ""; });
    // Images: only remote https images survive.
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, src) => {
      if (/^https:\/\//i.test(src)) return m;
      warn(`dropped local image ${src}`);
      return "";
    });
    // Wikilinks [[target|alias]].
    s = s.replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g, (m, target, alias) => {
      const label = (alias || target.split("#")[0].split("/").pop()).trim();
      const n = resolve(target);
      return n ? `[${label}](${hrefFor(n)})` : label;
    });
    // Markdown links: keep http(s)/mailto/#; rewrite links to published notes; anything else -> text.
    s = s.replace(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, text, href) => {
      if (/^(https?:|mailto:|#)/i.test(href)) return m;
      const n = resolve(href);
      if (n) return `[${text}](${hrefFor(n)})`;
      warn(`unlinked ${href}`);
      return text;
    });
    // Callouts > [!note] Title  ->  > **Title**
    s = s.replace(/^(\s*>\s*)\[!([A-Za-z-]+)\][+-]?\s*(.*)$/gm, (m, q, type, title) => `${q}**${title || type[0].toUpperCase() + type.slice(1)}**`);
    // Highlights and block ids.
    s = s.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
    s = s.replace(/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, "");
    return s;
  });
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
