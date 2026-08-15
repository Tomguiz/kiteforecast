import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The catalogue is a JS array literal inside index.html. Parse it by locating
// `const SPOTS=[` and walking brackets to the matching close, then eval the
// literal in a Function — it contains only object literals, no expressions.
export function parseSpotsArray(html) {
  const start = html.indexOf('const SPOTS=[')
  if (start === -1) throw new Error('SPOTS array not found in index.html')
  const open = html.indexOf('[', start)
  let depth = 0, end = -1
  for (let i = open; i < html.length; i++) {
    if (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end === -1) throw new Error('unterminated SPOTS array')
  const literal = html.slice(open, end + 1)
  const spots = new Function(`return ${literal}`)()
  return spots.map(s => ({
    name: s.name, loc: s.loc ?? '', lat: s.lat, lon: s.lon, dirs: s.dirs ?? [],
  }))
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

export function toSeedSql(spots) {
  const rows = spots.map(s =>
    `  (${q(s.name)}, ${q(s.loc)}, ${s.lat}, ${s.lon}, '{${s.dirs.join(',')}}', true)`
  ).join(',\n')
  return `INSERT INTO spots (name, loc, lat, lon, dirs, active) VALUES\n${rows}\n` +
    `ON CONFLICT (name) DO UPDATE SET\n` +
    `  loc = EXCLUDED.loc, lat = EXCLUDED.lat, lon = EXCLUDED.lon,\n` +
    `  dirs = EXCLUDED.dirs, active = EXCLUDED.active;\n`
}

// CLI: node tests/tools/generate-spots-seed.mjs
// (compared via pathToFileURL, not a raw `file://` template, so this still
// matches when invoked with a relative path or a path containing spaces —
// process.argv[1] is left exactly as typed, while import.meta.url is always
// an absolute, percent-encoded URL)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const spots = parseSpotsArray(html)
  writeFileSync(new URL('../../supabase/seed-spots.sql', import.meta.url), toSeedSql(spots))
  console.log(`wrote ${spots.length} spots`)
}
