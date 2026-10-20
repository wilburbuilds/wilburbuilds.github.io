// Leak scan: fails if built output contains private paths, hosts, secrets or Obsidian leftovers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ROOT } from "./lib.mjs";

const TEXT = /\.(html?|xml|css|js|mjs|json|txt|svg|md|webmanifest)$/i;

// [name, regex, codeToo]. codeToo=false means <pre>/<code> content is ignored for that rule.
const RULES = [
  ["local path", /\/Users\/|\/home\/[a-z]|[A-Z]:\\Users\\|\/private\/var\/|\/Volumes\//g, true],
  ["vault path", /\/vaults\/|\.obsidian\//gi, true],
  ["tailnet host", /\.ts\.net\b|\btail[0-9a-f]{6,}\b/gi, true],
  ["private IP / localhost", /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b127\.0\.0\.1\b|\blocalhost\b/gi, true],
  [".env reference", /\.env\b/gi, true],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, true],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/g, true],
  ["API key", /\bsk-[A-Za-z0-9_-]{20,}|\bxox[abposr]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}|\btk_[A-Za-z0-9]{20,}|\bxai-[A-Za-z0-9]{20,}/g, true],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, true],
  ["secret assignment", /\b(?:api[_-]?key|secret|token|passw(?:or)?d|bearer)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/gi, true],
  ["long hex string", /\b[a-f0-9]{32,}\b/gi, true],
  ["token-like string", /(?<![A-Za-z0-9_\-/.])(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{40,}(?![A-Za-z0-9_\-])/g, true],
  ["private scheme", /\b(?:obsidian|file):\/\//gi, true],
  ["wikilink leftover", /\[\[[^\]\n]+\]\]|!\[\[/g, false],
  ["Obsidian comment", /%%/g, false],
  ["frontmatter leak", /\bpublish:\s*(?:true|false)\b|^---\s*$/gim, false],
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const mask = (s) => (s.length <= 8 ? s.slice(0, 2) + "…" : s.slice(0, 4) + "…(" + s.length + " chars)");

export function scan(dir, { publicEmail = "", privatePatterns = [] } = {}) {
  const findings = [];
  const allowEmail = new Set([publicEmail.toLowerCase()].filter(Boolean));
  // Extra private strings (vault name, hostnames, IPs) from the untracked site.config.local.json.
  const extra = privatePatterns.filter(Boolean).map((p) => ["private pattern", new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), true]);
  for (const file of walk(dir)) {
    const rel = path.relative(dir, file);
    if (/(^|\/)\.env/.test(rel)) { findings.push({ file: rel, rule: ".env file in output", hit: rel }); continue; }
    if (!TEXT.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const prose = text.replace(/<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/gi, (m) => m.replace(/[^\n]/g, " "));
    const lineOf = (i) => text.slice(0, i).split("\n").length;
    for (const [rule, re, codeToo] of [...RULES, ...extra]) {
      const hay = codeToo ? text : prose;
      for (const m of hay.matchAll(re)) findings.push({ file: rel, line: lineOf(m.index), rule, hit: mask(m[0]) });
    }
    for (const m of text.matchAll(EMAIL)) {
      if (!allowEmail.has(m[0].toLowerCase())) findings.push({ file: rel, line: lineOf(m.index), rule: "email address", hit: mask(m[0]) });
    }
  }
  return findings;
}

export function report(findings) {
  for (const f of findings) console.error(`  ✗ ${f.rule}: ${f.file}${f.line ? ":" + f.line : ""}  [${f.hit}]`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const dir = path.resolve(ROOT, process.argv[2] || "dist");
  const findings = scan(dir, cfg);
  if (findings.length) { console.error(`Leak scan FAILED (${findings.length}):`); report(findings); process.exit(1); }
  console.log(`Leak scan passed: ${dir}`);
}
