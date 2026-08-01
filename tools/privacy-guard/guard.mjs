/* Pure scanning logic for the privacy guard. Knows nothing about the API or
   the filesystem — buildMatchers() takes already-resolved inputs so the whole
   surface is testable offline. patterns.mjs owns the sensitive knowledge. */

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Build the matcher set from a denylist config and the live private repo list.
 *  Two kinds of matcher:
 *   - "name": word-bounded, case-insensitive, not safelisted
 *   - "private-repo-url": a github.com/<user>/<repo> link to a private repo.
 *     These bypass the safeWords allowlist entirely — linking to a private repo
 *     is a leak even when the name itself is an innocuous word like "ansible".
 *
 *  minPatternLength guards only the *auto-derived* repo names: the private repo
 *  list is whatever happens to exist on the account, so short names like "a" or
 *  "hola" would match nearly every sentence. A repo name must therefore be
 *  strictly longer than minPatternLength to become a matcher. config.clients is
 *  a hand-curated denylist and is authoritative: entries below the threshold are
 *  deliberate there and are never dropped for being short.
 *
 *  This file is published. It must never quote a denylist entry verbatim — doing
 *  so would leak, through the guard's own source, exactly what the guard exists
 *  to protect. The guard caught precisely that mistake here on 2026-07-31. */
export function buildMatchers({config, privateRepos, user = "l0rdbarcsacs"}) {
  const safe = new Set(config.safeWords.map(w => w.toLowerCase()))
  const min = config.minPatternLength ?? 4

  const clients = config.clients.map(n => n.toLowerCase())
  const repos = privateRepos.map(n => n.toLowerCase()).filter(n => n.length > min)

  const names = [...new Set([...clients, ...repos])]
    .filter(n => !safe.has(n))
    .map(pattern => ({
      kind: "name",
      pattern,
      // \b does not fire next to "_" (a word char), so anchor on non-word-or-underscore
      regex: new RegExp(`(^|[^\\w-])${escapeRegExp(pattern)}([^\\w-]|$)`, "i"),
    }))

  const urls = privateRepos.map(repo => ({
    kind: "private-repo-url",
    pattern: repo.toLowerCase(),
    regex: new RegExp(`github\\.com/${escapeRegExp(user)}/${escapeRegExp(repo)}(?![\\w-])`, "i"),
  }))

  return [...urls, ...names]
}

/** Scan one document, returning every hit with file and 1-indexed line. */
export function scanText(text, matchers, file) {
  const hits = []
  const lines = text.split("\n")
  for (const [i, line] of lines.entries()) {
    for (const m of matchers) {
      if (m.regex.test(line))
        hits.push({file, line: i + 1, kind: m.kind, pattern: m.pattern, excerpt: line.trim().slice(0, 120)})
    }
  }
  return hits
}

export function formatHits(hits) {
  if (!hits.length)
    return "privacy-guard: clean"
  return [
    `privacy-guard: ${hits.length} potential leak(s)`,
    ...hits.map(h => `  ${h.file}:${h.line}  [${h.kind}] "${h.pattern}"  ${h.excerpt}`),
  ].join("\n")
}
