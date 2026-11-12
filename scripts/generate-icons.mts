// Regenerates the raster icons from src/app/icon.svg: favicon.ico (16 and 32px, transparent,
// PNG-in-ICO) and apple-icon.png (180px on opaque white, since iOS fills transparency with black).
// The SVG switches colours on prefers-color-scheme, so the render pins the light scheme.
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'

const ICON_SVG_PATH = new URL('../src/app/icon.svg', import.meta.url)
const FAVICON_PATH = new URL('../src/app/favicon.ico', import.meta.url)
const APPLE_ICON_PATH = new URL('../src/app/apple-icon.png', import.meta.url)
const FAVICON_SIZES = [16, 32]
const APPLE_ICON_SIZE = 180

async function renderPng(browser: Browser, svg: string, size: number, background: 'white' | 'transparent'): Promise<Buffer> {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: size, height: size } })
  try {
    const page = await context.newPage()
    await page.setContent(
      `<style>html,body{margin:0;background:${background}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    )
    return await page.screenshot({ omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } })
  } finally {
    await context.close()
  }
}

// ICO with PNG payloads (supported since Vista): 6-byte header, one 16-byte entry per image, then the images.
function buildIco(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size, 0)
    entry.writeUInt8(size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

const svg = readFileSync(ICON_SVG_PATH, 'utf8')
const browser = await chromium.launch()
try {
  const favicons = []
  for (const size of FAVICON_SIZES) favicons.push({ size, png: await renderPng(browser, svg, size, 'transparent') })
  writeFileSync(FAVICON_PATH, buildIco(favicons))
  writeFileSync(APPLE_ICON_PATH, await renderPng(browser, svg, APPLE_ICON_SIZE, 'white'))
} finally {
  await browser.close()
}
console.log(`wrote favicon.ico (${FAVICON_SIZES.join(', ')}px) and apple-icon.png (${APPLE_ICON_SIZE}px)`)
