// Makes a small share copy (WhatsApp / web / socials) of a rendered master.
// The master is only read. Video is capped at ~4 Mbps, audio is AAC 192k,
// so a 19 s ad lands around 10 MB with no visible change at normal viewing.
//
//   node scripts/share.js out/amrison-ad-v4-16x9.mp4   -> out/amrison-ad-v4-16x9-share.mp4
const { spawnSync } = require('child_process');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/share.js <master.mp4>'); process.exit(1); }
const out = src.replace(/\.mp4$/i, '-share.mp4');

const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '4M', '-bufsize', '8M',
  '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`wrote ${path.relative(process.cwd(), out)}`);
