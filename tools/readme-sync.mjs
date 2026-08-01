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

/** Live contribution totals with a real public/private split.
 *
 *  NOT restrictedContributionsCount. That field means "contributions I am not
 *  allowed to show *you*", which is a property of the viewer, not of the work.
 *  While "include private contributions" was off it happened to equal the private
 *  count; the moment the setting flipped it dropped from 4,680 to 66 and the
 *  README's headline claim became false on a live public page (2026-08-01).
 *
 *  The split below is derived from the repositories themselves, so it means the
 *  same thing regardless of who is asking or how the profile is configured. */
async function fetchContributionStats(token, login = "l0rdbarcsacs") {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
    body: JSON.stringify({
      query: `query($login:String!){ user(login:$login){ contributionsCollection{
        contributionCalendar{ totalContributions }
        commitContributionsByRepository(maxRepositories:100){
          repository{ isPrivate } contributions{ totalCount }
        }
        pullRequestContributionsByRepository(maxRepositories:100){
          repository{ isPrivate } contributions{ totalCount }
        }
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
  const tally = key => c[key].reduce((acc, e) => {
    const n = e.contributions.totalCount
    return e.repository.isPrivate ? {...acc, private: acc.private + n} : {...acc, public: acc.public + n}
  }, {private: 0, public: 0})

  const commits = tally("commitContributionsByRepository")
  const prs = tally("pullRequestContributionsByRepository")
  const priv = commits.private + prs.private
  const pub = commits.public + prs.public
  const attributed = priv + pub
  const total = c.contributionCalendar.totalContributions

  // Fail closed on an implausible answer.
  //
  // *ByRepository returns repository objects, so a token that cannot see private
  // repositories reports every contribution as public — while the calendar total
  // still reads ~4,800 because that figure is public once the profile setting is
  // on. The two disagree, and the section renders "0.0% of my commits land in
  // private repositories" directly under a 4,777-box private contribution city.
  //
  // That exact contradiction was published to the live profile on 2026-08-01 by a
  // CI run whose token had narrower visibility than the local one. Refusing to
  // emit is right: the caller carries over the previous value, and a stale true
  // number beats a fresh false one.
  if (attributed < total * 0.5)
    throw new Error(`readme-sync: only ${attributed} of ${total} contributions could be attributed to a repository — the token cannot see private repos`)
  if (priv === 0 && total > 500)
    throw new Error(`readme-sync: token reports 0 private contributions against a ${total} total — refusing to publish an implausible split`)

  return {
    total,
    private: priv,
    public: pub,
    privateRepos: c.commitContributionsByRepository.filter(e => e.repository.isPrivate).length,
    share: attributed ? priv / attributed : 0,
  }
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

// The whole blockquote is generated, not just the sentence inside it.
//
// An HTML comment at the START of a line opens an HTML block in CommonMark, and
// everything after it on that line stops being parsed as markdown. A marker
// written as `> <!-- BEGIN:stats -->**bold**` therefore published literal
// asterisks to the live profile on 2026-08-01. Owning both blockquote lines keeps
// every marker comment on its own line, where it is inert.
const statsLine = stats
  ? [
    "> Regenerated daily from the GitHub API, private repositories included in aggregate.",
    `> **${(stats.share * 100).toFixed(1)}% of my commits and pull requests land in private repositories** —`,
    `> ${fmt(stats.private)} against ${fmt(stats.public)} public, across ${stats.privateRepos} closed repos. The code stays closed, the volume does not.`,
  ].join("\n")
  : carryOver("stats") || "> Regenerated daily from the GitHub API, private repositories included in aggregate."

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
