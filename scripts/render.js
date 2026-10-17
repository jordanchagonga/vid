// Deterministic renderer: drives src/index.html in headless Chromium frame by
// frame and pipes PNG frames into FFmpeg together with build/audio.wav.
//
//   node scripts/render.js                       -> out/amrison-ad.mp4 (full render)
//   node scripts/render.js --out out/v2.mp4      -> full render to another file
//   node scripts/render.js --format vertical     -> 1080x1920 (9:16) instead of 1920x1080
//   node scripts/render.js --stills 0,4,121      -> build/stills/f0004.png ... (frame numbers)
//   node scripts/render.js --stills 100-130      -> a range of frames
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FPS = 30, DURATION = 19, TOTAL = FPS * DURATION; // 570 frames
const fmtArg = process.argv.indexOf('--format');
const VERTICAL = fmtArg >= 0 && process.argv[fmtArg + 1] === 'vertical';
const SIZE = VERTICAL ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
const PAGE = pathToFileURL(path.join(ROOT, 'src', 'index.html')).href + (VERTICAL ? '?format=vertical' : '');
const AUDIO = path.join(ROOT, 'build', 'audio.wav');
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? path.resolve(ROOT, process.argv[outArg + 1]) : path.join(ROOT, 'out', 'amrison-ad.mp4');

function parseFrames(spec) {
  return spec.split(',').flatMap(part => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }).filter(f => f >= 0 && f < TOTAL);
}

async function openPage() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => { console.error('[page error]', e); process.exitCode = 1; });
  await page.goto(PAGE);
  await page.evaluate(() => window.adReady);
  return { browser, page, canvas: await page.$('canvas') };
}

async function frame(page, canvas, n) {
  await page.evaluate(t => window.renderFrame(t), n / FPS);
  return canvas.screenshot({ type: 'png' });
}

async function stills(spec) {
  const dirArg = process.argv.indexOf('--dir');
  const dir = dirArg >= 0 ? path.resolve(ROOT, process.argv[dirArg + 1]) : path.join(ROOT, 'build', 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page, canvas } = await openPage();
  for (const n of parseFrames(spec)) {
    fs.writeFileSync(path.join(dir, `f${String(n).padStart(4, '0')}.png`), await frame(page, canvas, n));
  }
  await browser.close();
  console.log(`stills written to ${path.relative(ROOT, dir)}`);
}

async function video() {
  if (!fs.existsSync(AUDIO)) throw new Error('build/audio.wav missing: run `npm run audio` first');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-i', AUDIO,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-profile:v', 'high',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '320k', '-ar', '44100',
    '-t', String(DURATION), '-movflags', '+faststart',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

  const { browser, page, canvas } = await openPage();
  const t0 = Date.now();
  for (let n = 0; n < TOTAL; n++) {
    const png = await frame(page, canvas, n);
    if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r));
    if (n % 60 === 0) process.stdout.write(`frame ${n}/${TOTAL}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
  ff.stdin.end();
  await browser.close();
  await done;
  console.log(`wrote ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const i = process.argv.indexOf('--stills');
(i >= 0 ? stills(process.argv[i + 1] || '0') : video()).catch(e => { console.error(e); process.exit(1); });
