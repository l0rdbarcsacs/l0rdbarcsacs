#!/usr/bin/env node
/* Fills the generated sections of README.tpl.md and writes README.md.
   Sections: writing (RSS), contrib3d (image embed), commits and stats (live
   contribution counts), footer (generation timestamp). Everything else is
   hand-written prose.

   The contribution numbers are fetched rather than hard-coded on purpose: a
   README that brags about "4,776 contributions" is wrong the day after it is
   written, and a stale boast is worse than no boast. */

import {readFileSync, writeFileSync} from "node:fs"
import {replaceAll} from "./sync.mjs"

const FEED = "https://jose.cerberus.cl/rss.xml"
const TZ = "America/Santiago"
const GRAPHQL = "https://api.github.com/graphql"

function esc(s) {
  // Decode first so a feed title that already contains an entity (&amp;, &apos;)
  // is not double-escaped into &amp;amp;.
  const decoded = String(s)
    .replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) =>
      ({amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'"})[e])
  return decoded.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Live contribution totals, including the private ones that are the whole point. */
async function fetchContributionStats(token, login = "l0rdbarcsacs") {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
    body: JSON.stringify({
      query: `query($login:String!){ user(login:$login){ contributionsCollection{
        restrictedContributionsCount
        contributionCalendar{ totalContributions }
      }}}`,
      variables: {login},
    }),
  })
  if (!res.ok)
    throw new Error(`readme-sync: contribution API ${res.status}`)
  const {data, errors} = await res.json()
  if (errors)
    throw new Error(`readme-sync: ${JSON.stringify(errors)}`)
  const c = data.user.contributionsCollection
  return {total: c.contributionCalendar.totalContributions, private: c.restrictedContributionsCount}
}

const fmt = n => n.toLocaleString("en-US")
const compact = n => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n))

/** Minimal RSS <item> extraction — the feed is ours and well-formed, so a
 *  dependency-free regex parse is proportionate here. */
async function fetchPosts(limit = 4) {
  const res = await fetch(FEED, {headers: {"user-agent": "cerberus-readme-sync"}})
  if (!res.ok)
    throw new Error(`readme-sync: feed returned ${res.status}`)
  const xml = await res.text()
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit)
  return items.map(([, block]) => {
    const pick = tag => {
      const m = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`).exec(block)
      return m ? m[1].trim() : ""
    }
    return {title: pick("title"), link: pick("link"), date: pick("pubDate")}
  })
}

function renderWriting(posts) {
  if (!posts.length)
    return "_No posts yet._"
  return posts.map(p => {
    const d = new Date(p.date)
    const stamp = Number.isNaN(d.getTime()) ? "" : ` · <sub>${d.toISOString().slice(0, 10)}</sub>`
    return `- **[${esc(p.title)}](${p.link})**${stamp}`
  }).join("\n")
}

const tpl = readFileSync(new URL("../README.tpl.md", import.meta.url), "utf8")

let posts = []
try {
  posts = await fetchPosts()
} catch (error) {
  console.warn(`readme-sync: ${error.message} — writing section left empty`)
}

// Degrade to the previous README's numbers rather than printing a placeholder:
// a token outage must never publish "NaN commits/year" to a public profile.
let stats = null
try {
  const token = process.env.GITHUB_TOKEN ?? process.env.METRICS_TOKEN
  if (!token)
    throw new Error("no GITHUB_TOKEN — contribution stats skipped")
  stats = await fetchContributionStats(token)
} catch (error) {
  console.warn(`readme-sync: ${error.message}`)
}

const previous = (() => {
  try {
    return readFileSync(new URL("../README.md", import.meta.url), "utf8")
  } catch {
    return ""
  }
})()
const carryOver = name => {
  const m = new RegExp(`<!-- BEGIN:${name} -->\\n?([\\s\\S]*?)\\n?<!-- END:${name} -->`).exec(previous)
  return m ? m[1] : ""
}

const commits = stats ? compact(stats.total) : carryOver("commits") || "4.7k"
const statsLine = stats
  ? `**${fmt(stats.private)} of my ${fmt(stats.total)} contributions in the last year are in private repositories** — the code stays closed, the volume does not.`
  : carryOver("stats") || "The code stays closed, the volume does not."

const now = new Date().toLocaleString("en-CA", {timeZone: TZ, dateStyle: "medium", timeStyle: "short"})

const out = replaceAll(tpl, {
  commits,
  stats: statsLine,
  contrib3d: `<img src="assets/contrib/contrib-3d.svg" alt="Isometric 3D contribution matrix including private repositories" width="100%">`,
  writing: renderWriting(posts),
  footer: `<sub>Regenerated ${now} · Santiago, Chile · every panel on this page is produced by a workflow in this repository</sub>`,
})

writeFileSync(new URL("../README.md", import.meta.url), out)
console.log(`readme-sync: wrote README.md (${posts.length} posts, stats ${stats ? "live" : "carried over"})`)
