/* Marker-based README composition. README.tpl.md is hand-written and owns the
   prose; generated sections are swapped in between HTML comment markers so the
   two never fight. Idempotent by construction: the markers survive every pass. */

export function replaceSection(doc, name, content) {
  const begin = `<!-- BEGIN:${name} -->`
  const end = `<!-- END:${name} -->`
  const start = doc.indexOf(begin)
  const stop = doc.indexOf(end)
  if (start < 0 || stop < 0 || stop < start)
    throw new Error(`readme-sync: marker "${name}" not found`)

  // Inline vs block. A marker pair written on ONE line is a mid-sentence
  // substitution ("· <!--BEGIN:commits--><!--END:commits--> commits/year") or sits
  // inside a blockquote, where injecting newlines would break out of the quote or
  // split the sentence. Only pad with newlines when the template itself spans
  // lines. Idempotent either way: the decision is re-derived from the same shape
  // on every pass.
  const inner = doc.slice(start + begin.length, stop)
  const inline = !inner.includes("\n") && !content.includes("\n")

  // Slice-and-join rather than String.replace: replace() interprets "$&" and
  // friends in the replacement string, which would corrupt any content with a $.
  const body = inline ? content : `\n${content}\n`
  return doc.slice(0, start + begin.length) + body + doc.slice(stop)
}

export function replaceAll(doc, sections) {
  return Object.entries(sections).reduce((acc, [name, content]) => replaceSection(acc, name, content), doc)
}
