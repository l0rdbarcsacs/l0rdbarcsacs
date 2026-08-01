/* Resolves the two pattern sources: the private denylist (from config/denylist.json
   locally, or the PRIVACY_DENYLIST secret in CI) and the live list of private repo
   names from the GitHub API. Never bundled into the public repo with real content —
   sync-tools.mjs ships this file, but the JSON it reads is CI-injected. */

import {readFileSync, existsSync} from "node:fs"

const GRAPHQL = "https://api.github.com/graphql"

export function loadConfig({path, env = process.env.PRIVACY_DENYLIST} = {}) {
  if (env)
    return JSON.parse(env)
  if (path && existsSync(path))
    return JSON.parse(readFileSync(path, "utf8"))
  throw new Error("privacy-guard: no denylist available (set PRIVACY_DENYLIST or pass --config)")
}

export async function fetchPrivateRepoNames({token, login = "l0rdbarcsacs"}) {
  const names = []
  let cursor = null
  do {
    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
      body: JSON.stringify({
        query: `query($login:String!,$cursor:String){
          user(login:$login){
            repositories(privacy:PRIVATE, first:100, after:$cursor, affiliations:[OWNER,COLLABORATOR]){
              pageInfo{hasNextPage endCursor}
              nodes{name}
            }
          }
        }`,
        variables: {login, cursor},
      }),
    })
    if (!res.ok)
      throw new Error(`privacy-guard: GitHub API ${res.status}`)
    const {data, errors} = await res.json()
    if (errors)
      throw new Error(`privacy-guard: ${JSON.stringify(errors)}`)
    const repos = data.user.repositories
    names.push(...repos.nodes.map(n => n.name))
    cursor = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null
  } while (cursor)
  return names
}
