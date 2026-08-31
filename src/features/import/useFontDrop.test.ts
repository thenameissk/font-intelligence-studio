import { describe, expect, it } from 'vitest'
import { hasFontExtension } from './useFontDrop'

describe('hasFontExtension', () => {
  it('accepts the formats the parser handles', () => {
    for (const name of ['a.ttf', 'B.OTF', 'x.woff', 'y.woff2', 'z.ttc']) {
      expect(hasFontExtension(name)).toBe(true)
    }
  })

  it('rejects images, so dropping a photo cannot close the open font', () => {
    for (const name of ['ref.png', 'scan.jpg', 'a.bmp', 'shot.webp', 'v.svg']) {
      expect(hasFontExtension(name)).toBe(false)
    }
  })

  it('rejects anything else', () => {
    expect(hasFontExtension('notes.txt')).toBe(false)
    expect(hasFontExtension('archive.zip')).toBe(false)
    expect(hasFontExtension('noextension')).toBe(false)
  })
})
