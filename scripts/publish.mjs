// Publish: build (with leak scan), commit dist/ to the gh-pages branch, push it. Never force-pushes.
// Does nothing unless an `origin` remote pointing at github.com/wilburbuilds/* exists.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./lib.mjs";
import { build } from "./build.mjs";

const t0 = performance.now();
const git = (args, env = {}) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};

const remote = git(["remote", "get-url", "origin"]);
if (!remote.ok) { console.error("No `origin` remote configured. Nothing published."); process.exit(1); }
if (!/github\.com[:/]wilburbuilds\//i.test(remote.out)) { console.error(`Refusing: origin is not under github.com/wilburbuilds (${remote.out}).`); process.exit(1); }

try { build(); } catch (e) { if (!e.findings) console.error(e.message); console.error("Build failed. Nothing published."); process.exit(1); }

const dist = path.join(ROOT, "dist");
const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "site-pub-")), "index");
const env = { GIT_INDEX_FILE: index };
if (!git(["--work-tree", dist, "add", "-A", "."], env).ok) { console.error("git add failed"); process.exit(1); }
const tree = git(["write-tree"], env).out;
const parent = git(["rev-parse", "--verify", "-q", "refs/heads/gh-pages"]);
if (parent.ok && git(["rev-parse", `${parent.out}^{tree}`]).out === tree) {
  console.log("dist/ unchanged since last publish. Nothing to push.");
  process.exit(0);
}
const commit = git(["commit-tree", tree, ...(parent.ok ? ["-p", parent.out] : []), "-m", `Publish ${new Date().toISOString()}`]);
if (!commit.ok) { console.error(commit.err); process.exit(1); }
git(["update-ref", "refs/heads/gh-pages", commit.out]);
const push = git(["push", "origin", "refs/heads/gh-pages:refs/heads/gh-pages"]);
if (!push.ok) { console.error(push.err); process.exit(1); }
console.log(`Published ${commit.out.slice(0, 7)} to gh-pages in ${Math.round(performance.now() - t0)} ms.`);
