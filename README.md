# personal-site

A small static site in the spirit of [karrisaarinen.com](https://karrisaarinen.com/): write in Obsidian, run one command, and it renders plain HTML, scans it for leaks, backs it up, and publishes to GitHub Pages.

## Writing a post

Put a note in the Obsidian `writing/` folder with frontmatter. The folder path is `sourceDir`, set per machine in the untracked `site.config.local.json` (for example `{ "sourceDir": "~/path/to/vault/writing" }`), so the vault path never lands in git:

```yaml
---
title: Room for ambition
date: 2026-10-20
publish: true
description: Optional one-line summary.
slug: room-for-ambition   # optional, defaults to the file name
---
```

Only notes with an unquoted `publish: true` are built. Everything else in the folder (drafts, `publish: false`, no frontmatter, anything under a `_` or `.` folder) is ignored. If no note is published, the site falls back to `content-sample/`.

Obsidian bits are cleaned up: links to published notes become real links, links to anything else become plain text, embeds (`![[...]]`) and local images are dropped, `%% comments %%` are removed, callouts become plain quotes, frontmatter never reaches the page.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Render to `dist/`, run the leak scan (dist is only replaced if it passes), save a backup to `~/.local/share/personal-site/backups/` (newest 20 kept). |
| `npm run preview` | Serve `dist/` on `127.0.0.1:4321` (next free port if taken). |
| `npm run publish` | Build, then commit `dist/` to the `gh-pages` branch and push it. Refuses without an `origin` under `github.com/wilburbuilds`. Never force-pushes. |
| `npm run scan` | Re-run the leak scan on `dist/`. |
| `npm test` | Self-checks for the publish guard, clean-up and leak scan. |

## Leak scan

The build fails if output contains local paths, vault or tailnet names, private IPs, `.env`, email addresses other than `publicEmail`, private keys, or API-token-looking strings, or if any wikilink, `%%` comment or frontmatter survives. Add your own private strings (vault name, hostnames, IPs) as `privatePatterns` in the untracked `site.config.local.json`.

## Home page

Name, About text, the optional Notes list and links live in `site.config.json`. Writing is listed by year, newest first.

Dependencies: Node stdlib plus `marked` (pinned).
