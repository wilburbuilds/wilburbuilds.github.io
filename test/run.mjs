// Self-checks for the publish guard, Obsidian clean-up and leak scan. Uses temp fixtures only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { collectNotes, makeResolver, cleanObsidian, isPublished } from "../scripts/lib.mjs";
import { scan } from "../scripts/scan.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "site-test-"));
const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true }); fs.writeFileSync(path.join(tmp, f), s); };
let n = 0; const ok = (name) => console.log(`  ✓ ${name}`, ++n);

w("notes/public.md", "---\ntitle: Public one\ndate: 2026-01-02\npublish: true\n---\nSee [[Private draft]], [[Other public|the other]], ![[secret.png]], ![x](../attachments/a.png).\n%% hidden %%\n\n```\n[[kept in code]]\n```\n");
w("notes/other.md", "---\ntitle: Other public\ndate: 2025-05-05\npublish: true\n---\nhi [file](public.md) [ext](https://example.com) [local](Private%20draft.md)\n");
w("notes/Private draft.md", "---\ntitle: Private draft\npublish: false\n---\nsecret\n");
w("notes/quoted.md", "---\npublish: \"true\"\n---\nx\n");
w("notes/yes.md", "---\npublish: yes\n---\nx\n");
w("notes/none.md", "no frontmatter\n");
w("notes/_templates/t.md", "---\npublish: true\n---\ntemplate\n");

const { published, skipped } = collectNotes(path.join(tmp, "notes"));
assert.deepEqual(published.map((p) => p.title), ["Public one", "Other public"]);
assert.equal(skipped, 4); ok("only unquoted publish: true is collected; _folders skipped");
assert.equal(isPublished({ publish: "true" }), false); assert.equal(isPublished({}), false); ok("guard rejects missing/quoted publish");

const resolve = makeResolver(published);
const md = cleanObsidian(published[0].body, { resolve, hrefFor: (m) => `../${m.slug}/` });
assert.match(md, /See Private draft,/); ok("wikilink to unpublished → plain text");
assert.match(md, /\[the other\]\(\.\.\/other\/\)/); ok("wikilink to published → link");
assert.doesNotMatch(md, /secret\.png|attachments/); ok("embeds and local images dropped");
assert.doesNotMatch(md, /hidden/); ok("Obsidian comments removed");
assert.match(md, /\[\[kept in code\]\]/); ok("code blocks untouched");
const md2 = cleanObsidian(published[1].body, { resolve, hrefFor: (m) => `../${m.slug}/` });
assert.match(md2, /\[file\]\(\.\.\/public\/\)/); assert.match(md2, /\[ext\]\(https:\/\/example\.com\)/); assert.match(md2, / local\n?$/m); ok("md links: published rewritten, external kept, private unlinked");

const out = path.join(tmp, "dist"); fs.mkdirSync(out);
fs.writeFileSync(path.join(out, "index.html"), "<p>clean page, hello@example.org is public</p>");
assert.equal(scan(out, { publicEmail: "hello@example.org" }).length, 0); ok("scan passes clean output + allowed email");
const bad = ["/Users/someone/x", "box.tailabc123.ts.net", "see .env", "me@private.com", "ghp_" + "a".repeat(30), "tk_" + "b1".repeat(15), "[[Private draft]]", "publish: true", "100.101.102.103", "token=" + "abc123".repeat(4)];
for (const b of bad) {
  fs.writeFileSync(path.join(out, "index.html"), `<p>${b}</p>`);
  assert.ok(scan(out, { publicEmail: "hello@example.org" }).length > 0, `scan should catch ${b.slice(0, 12)}`);
}
ok(`scan catches ${bad.length} planted leaks`);
fs.writeFileSync(path.join(out, "index.html"), "<p>notes from my-secret-vault</p>");
assert.ok(scan(out, { privatePatterns: ["my-secret-vault"] }).length > 0); ok("scan catches configured private patterns");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`All ${n} checks passed.`);
