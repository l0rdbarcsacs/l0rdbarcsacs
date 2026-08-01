#!/usr/bin/env node
/* CI entrypoint. Exits 1 on any hit so a leaking commit can never land.
   Usage: node cli.mjs --config ../../config/denylist.json README.md assets/**\/*.svg */

import {readFileSync, statSync} from "node:fs"
import {globSync} from "node:fs"
import {buildMatchers, scanText, formatHits} from "./guard.mjs"
import {loadConfig, fetchPrivateRepoNames} from "./patterns.mjs"

const args = process.argv.slice(2)
const configIndex = args.indexOf("--config")
const configPath = configIndex >= 0 ? args[configIndex + 1] : null
// Only skip the --config VALUE when --config is actually present: with no flag
// configIndex is -1, and "i !== configIndex + 1" would silently drop args[0] —
// in CI the guard runs on the PRIVACY_DENYLIST secret with no --config, so the
// first file (README.md) would go unscanned.
const configValueIndex = configIndex >= 0 ? configIndex + 1 : -1
const globs = args.filter((a, i) => !a.startsWith("--") && i !== configValueIndex)

const config = loadConfig({path: configPath})
const token = process.env.METRICS_TOKEN ?? process.env.GITHUB_TOKEN
if (!token)
  throw new Error("privacy-guard: GITHUB_TOKEN is required")

const privateRepos = await fetchPrivateRepoNames({token})
const matchers = buildMatchers({config, privateRepos})

// node:fs globSync has no `nodir` option, so directories are filtered explicitly.
const files = [...new Set(globs.flatMap(g => globSync(g)))].filter(f => statSync(f).isFile())
if (!files.length)
  throw new Error(`privacy-guard: no files matched ${globs.join(" ")}`)

const hits = files.flatMap(file => scanText(readFileSync(file, "utf8"), matchers, file))
console.log(formatHits(hits))
console.log(`privacy-guard: scanned ${files.length} file(s) against ${matchers.length} matcher(s)`)
process.exit(hits.length ? 1 : 0)
