#!/usr/bin/env node
/* Renders README.md through GitHub's own markdown API and writes a page we can
   screenshot, so what we review is what GitHub will actually serve — including
   which HTML survives sanitisation.

   Two things this deliberately gets right, both found by a review on 2026-07-31:

   1. mode "markdown", NOT "gfm". The gfm mode is for issues and comments: it
      turns single newlines into <br> and autolinks bare @mentions. Rendering this
      README in gfm produced 18 spurious line breaks and linkified "@Open" to a
      user page — defects that do not exist on the real profile. The REST docs
      define "markdown" as rendering "just like README.md files are rendered".
   2. A <base href> pointing at the repo root. Every image src in the README is
      repo-relative ("assets/..."), while this page is written to a temp dir, so
      without a base the images can never resolve and every panel reviews as a
      broken image.

   Mermaid is rendered client-side by GitHub and will NOT appear here; verify
   diagrams on a real repo page. */

import {readFileSync, writeFileSync, mkdirSync} from "node:fs"
import {execFileSync} from "node:child_process"
import {fileURLToPath} from "node:url"

const OUT = process.env.PREVIEW_OUT ?? "/tmp/claude-1000/preview"
const REPO = fileURLToPath(new URL("..", import.meta.url))
const md = readFileSync(`${REPO}README.md`, "utf8")

const token = process.env.GITHUB_TOKEN ?? execFileSync("gh", ["auth", "token"]).toString().trim()
const res = await fetch("https://api.github.com/markdown", {
  method: "POST",
  headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
  body: JSON.stringify({text: md, mode: "markdown"}),
})
if (!res.ok)
  throw new Error(`render-preview: markdown API ${res.status}`)

const body = await res.text()
const html = `<!doctype html><meta charset="utf-8">
<base href="file://${REPO}">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5/github-markdown-dark.css">
<style>body{background:#0d1117;margin:0;padding:32px}
.markdown-body{max-width:1012px;margin:0 auto;background:#0d1117}
.markdown-body hr{height:1px;background:#21262d;border:0;margin:24px 0}</style>
<article class="markdown-body">${body}</article>`

mkdirSync(OUT, {recursive: true})
writeFileSync(`${OUT}/readme.html`, html)

// Surface unresolved images immediately rather than letting them look like design
// defects in the screenshot review.
const missing = [...body.matchAll(/<img[^>]+src="(?!https?:)([^"]+)"/g)]
  .map(m => m[1])
  .filter(src => {
    try {
      readFileSync(`${REPO}${src}`)
      return false
    } catch {
      return true
    }
  })

console.log(`render-preview: wrote ${OUT}/readme.html (base ${REPO})`)
if (missing.length)
  console.warn(`render-preview: ${missing.length} image(s) not on disk yet:\n  ${missing.join("\n  ")}`)
