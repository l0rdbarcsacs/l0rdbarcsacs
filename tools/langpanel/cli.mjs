#!/usr/bin/env node
/* Usage: node cli.mjs <output.svg> [--config path/to/denylist.json]
   The vendored-repository exclusion list names private repositories, so it is
   never stored in this repo: it comes from PRIVACY_DENYLIST in CI, or --config
   locally, exactly like the privacy guard. */

import {writeFileSync, mkdirSync, readFileSync, existsSync} from "node:fs"
import {dirname} from "node:path"
import {fetchRepoLanguages, aggregate} from "./fetch.mjs"
import {renderLanguagePanel} from "./render.mjs"

const argv = process.argv.slice(2)
const arg = name => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : null
}
const out = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--config") ?? "language-panel.svg"

const token = process.env.METRICS_TOKEN ?? process.env.GITHUB_TOKEN
if (!token)
  throw new Error("langpanel: GITHUB_TOKEN is required")

const configPath = arg("config")
const configRaw = process.env.PRIVACY_DENYLIST
  ?? (configPath && existsSync(configPath) ? readFileSync(configPath, "utf8") : null)
const excluded = configRaw ? (JSON.parse(configRaw).vendoredRepos ?? []) : []
if (!excluded.length)
  console.warn("langpanel: no vendored-repo exclusions loaded — third-party source will skew the chart")

const repos = await fetchRepoLanguages({token})
const data = aggregate(repos, {excluded, limit: 8})

const svg = renderLanguagePanel(data, {
  title: "LANGUAGE DISTRIBUTION",
  note: data.excludedCount
    ? `measured across ${data.repoCount} owned repositories · vendored third-party source excluded · markup and notebooks excluded`
    : `measured across ${data.repoCount} owned repositories · markup and notebooks excluded`,
})

mkdirSync(dirname(out), {recursive: true})
writeFileSync(out, svg)
console.log(`langpanel: wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${data.languages.length} languages, ${data.repoCount} repos, ${data.excludedCount} excluded)`)
