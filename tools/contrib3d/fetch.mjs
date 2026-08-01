/* Fetches the contribution calendar. With a PAT carrying `repo` scope this
   includes private contributions, which is the entire point: 4,680 of the
   user's 4,776 annual contributions live in private repositories. */

const GRAPHQL = "https://api.github.com/graphql"

const QUERY = `query($login:String!,$from:DateTime,$to:DateTime){
  user(login:$login){
    contributionsCollection(from:$from, to:$to){
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ date contributionCount contributionLevel } }
      }
    }
  }
}`

const LEVELS = {NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4}

export async function fetchCalendar({token, login = "l0rdbarcsacs", from = null, to = null}) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: {authorization: `bearer ${token}`, "content-type": "application/json"},
    body: JSON.stringify({query: QUERY, variables: {login, from, to}}),
  })
  if (!res.ok)
    throw new Error(`contrib3d: GitHub API ${res.status}`)
  const {data, errors} = await res.json()
  if (errors)
    throw new Error(`contrib3d: ${JSON.stringify(errors)}`)

  const cal = data.user.contributionsCollection.contributionCalendar
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map(w => ({
      days: w.contributionDays.map(d => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? 0,
      })),
    })),
  }
}
