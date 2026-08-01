/* Language distribution across owned repositories, computed from the GraphQL API.

   WHY THIS EXISTS INSTEAD OF lowlighter/metrics — established by measurement on
   2026-07-31, not preference:

   - Every metrics plugin with real signal for this account (habits, activity,
     languages "recent") derives from the PUBLIC events API. On an account whose
     work is 98% private those plugins are structurally blind: `habits` rendered a
     red "Unexpected error" panel, and the `recent` languages section silently
     produced nothing.
   - The one plugin that does see private data counts bytes per repository, which
     measures what is CHECKED IN rather than what was WRITTEN. A single repository
     holding vendored third-party source contributed 7.3 MB of Java — 15% of the
     whole chart — for a language its owner has never claimed to use.

   So this module counts the same GraphQL data but excludes repositories that hold
   third-party or vendored source. The exclusion list is deliberately NOT stored
   here: it names private repositories. It arrives from config/denylist.json
   locally, or the PRIVACY_DENYLIST secret in CI, exactly like the privacy guard. */

const GRAPHQL = "https://api.github.com/graphql"

const QUERY = `query($login:String!,$cursor:String){
  user(login:$login){
    repositories(first:100, after:$cursor, ownerAffiliations:OWNER, isFork:false){
      pageInfo{ hasNextPage endCursor }
      nodes{
        name
        languages(first:20, orderBy:{field:SIZE, direction:DESC}){
          edges{ size node{ name color } }
        }
      }
    }
  }
}`

/** Languages that describe markup, notebooks or config rather than engineering
 *  work. Excluded so the chart answers "what does this person build with". */
export const NON_ENGINEERING = new Set([
  "HTML", "CSS", "SCSS", "Less", "Jupyter Notebook", "Dockerfile", "Makefile",
  "Batchfile", "Roff", "Procfile", "TSQL", "PLpgSQL", "Vim Script", "Nix",
])

export async function fetchRepoLanguages({token, login = "l0rdbarcsacs"}) {
  const repos = []
  let cursor = null
  do {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
      body: JSON.stringify({query: QUERY, variables: {login, cursor}}),
    })
    if (!res.ok)
      throw new Error(`langpanel: GitHub API ${res.status}`)
    const {data, errors} = await res.json()
    if (errors)
      throw new Error(`langpanel: ${JSON.stringify(errors)}`)
    const page = data.user.repositories
    repos.push(...page.nodes)
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
  } while (cursor)
  return repos
}

/** Aggregate repositories into a ranked language list.
 *  @param repos       raw nodes from fetchRepoLanguages
 *  @param excluded    repository names holding vendored/third-party source
 *  @param limit       how many languages to show before folding into "Other" */
export function aggregate(repos, {excluded = [], limit = 8, includeNonEngineering = false} = {}) {
  const skip = new Set(excluded.map(n => n.toLowerCase()))
  const totals = new Map()
  let repoCount = 0

  for (const repo of repos) {
    if (skip.has(repo.name.toLowerCase()))
      continue
    repoCount++
    for (const {size, node} of repo.languages.edges) {
      if (!includeNonEngineering && NON_ENGINEERING.has(node.name))
        continue
      const prev = totals.get(node.name) ?? {bytes: 0, repos: 0, color: node.color}
      // repos: in how many distinct projects does this language appear. Bytes measure
      // volume, which one data-heavy repository can dominate; repos measure breadth,
      // which is what a reader is actually trying to infer from a language chart.
      totals.set(node.name, {bytes: prev.bytes + size, repos: prev.repos + 1, color: node.color ?? prev.color})
    }
  }

  const ranked = [...totals.entries()]
    .map(([name, {bytes, repos, color}]) => ({name, bytes, repos, color}))
    .sort((a, b) => b.bytes - a.bytes)

  const total = ranked.reduce((sum, l) => sum + l.bytes, 0)
  const shown = ranked.slice(0, limit)
  const rest = ranked.slice(limit)
  if (rest.length) {
    shown.push({
      name: `Other (${rest.length})`,
      bytes: rest.reduce((sum, l) => sum + l.bytes, 0),
      repos: null,
      color: null,
    })
  }

  return {
    total,
    repoCount,
    excludedCount: repos.length - repoCount,
    languages: shown.map(l => ({...l, share: total ? l.bytes / total : 0})),
  }
}
