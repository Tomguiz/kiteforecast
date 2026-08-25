import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

// The home-screen install is a WebAPK: the browser asks a Google service to
// mint a real APK wrapping the site. We do not choose its targetSdkVersion —
// that is why a Play Protect "built for an older version of Android" warning
// cannot be fixed from this repo. What the manifest DOES decide is whether the
// browser mints a proper WebAPK at all or falls back to a legacy shortcut, and
// a lone 500x500 icon declared `sizes: "any"` was not carrying that reliably.
const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'))
const root = (f: string) => new URL('../../' + f, import.meta.url)

describe('web app manifest', () => {
  it('declares the fields an installable PWA needs', () => {
    for (const k of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color', 'icons']) {
      expect(manifest[k], k).toBeTruthy()
    }
    expect(manifest.display).toBe('standalone')
  })

  it('offers both icon sizes Chrome looks for, with explicit dimensions', () => {
    const any = manifest.icons.filter((i: any) => (i.purpose || 'any').split(' ').includes('any'))
    const sizes = any.map((i: any) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    // "any" is for scalable formats; on a PNG it leaves the browser guessing
    for (const i of manifest.icons) expect(i.sizes).not.toBe('any')
  })

  it('ships a separate maskable icon, so Android does not crop the logo', () => {
    const maskable = manifest.icons.filter((i: any) => (i.purpose || '').split(' ').includes('maskable'))
    expect(maskable.length).toBeGreaterThan(0)
    // it must not be the same file as the plain icon: maskable needs a safe
    // zone, and Android crops to a circle
    const plain = manifest.icons.filter((i: any) => (i.purpose || 'any').split(' ').includes('any')).map((i: any) => i.src)
    for (const m of maskable) expect(plain).not.toContain(m.src)
  })

  it('every icon file it names actually exists', () => {
    for (const i of manifest.icons) expect(existsSync(root(i.src)), i.src).toBe(true)
  })
})
