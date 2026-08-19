import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Email clients are far less forgiving than browsers about table markup, and
// they disagree with each other about how to repair it. A <tr> that sits
// directly in a <td> with no <table> around it — which is how the OFF
// templates' amber notice was written — renders with its padding stacked on
// top of the parent cell's in some clients and dropped entirely in others.
// It never throws; it just looks wrong in a way only a screenshot catches.

const EMAILS = join(__dirname, '..', '..', 'emails')
const templates = readdirSync(EMAILS).filter(f => f.endsWith('.html'))

function badNesting(html: string): string[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, '')
  const stack: { tag: string; line: number }[] = []
  const errs: string[] = []
  const re = /<(\/?)(table|tr|td|th)\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const close = m[1] === '/'
    const tag = m[2].toLowerCase()
    const line = src.slice(0, m.index).split('\n').length
    if (close) {
      const top = stack.pop()
      if (top?.tag !== tag) errs.push(`line ${line}: </${tag}> closes <${top?.tag ?? 'nothing'}>`)
    } else {
      const parent = stack[stack.length - 1]?.tag
      if (tag === 'tr' && parent !== 'table')
        errs.push(`line ${line}: <tr> inside <${parent ?? 'nothing'}>, expected <table>`)
      if ((tag === 'td' || tag === 'th') && parent !== 'tr')
        errs.push(`line ${line}: <${tag}> inside <${parent ?? 'nothing'}>, expected <tr>`)
      stack.push({ tag, line })
    }
  }
  for (const u of stack) errs.push(`line ${u.line}: <${u.tag}> never closed`)
  return errs
}

describe('email template table nesting', () => {
  it('checks every template in emails/', () => {
    expect(templates.length).toBeGreaterThan(10)
  })

  it.each(templates)('%s nests table/tr/td correctly', file => {
    expect(badNesting(readFileSync(join(EMAILS, file), 'utf8'))).toEqual([])
  })

  it('detects the exact defect the OFF notices had', () => {
    const broken = `<table><tr><td>
      <tr><td style="padding:0 32px">stray</td></tr>
    </td></tr></table>`
    expect(badNesting(broken)).toContainEqual(
      expect.stringContaining('<tr> inside <td>, expected <table>'))
  })
})
