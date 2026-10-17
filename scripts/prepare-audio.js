// Cuts the approved 19 s section from the original soundtrack into build/audio.wav.
// The source file is only read, never modified. No speed or pitch change:
//   - 3.40 s -> 22.40 s slice (sample-accurate atrim)
//   - 10 ms fade-in, 60 ms fade-out to avoid clicks at the edit points
//   - -3.5 dB clean gain (no limiter): the MP3 decodes with overs up to +2.6 dBFS
//     in this section, so this brings true peak to about -0.9 dBTP without
//     clipping or compressing anything. Written as float WAV so nothing clips in between.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'audio', 'soundtrack.mp3');
const OUT = path.join(ROOT, 'build', 'audio.wav');
const IN_POINT = 3.40;
const DURATION = 19.0;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const filter = [
  `atrim=start=${IN_POINT}:end=${IN_POINT + DURATION}`,
  'asetpts=PTS-STARTPTS',
  'afade=t=in:st=0:d=0.01',
  `afade=t=out:st=${DURATION - 0.06}:d=0.06`,
  'volume=-3.5dB',
].join(',');

const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', SRC, '-af', filter,
  '-ar', '44100', '-ac', '2', '-c:a', 'pcm_f32le', OUT], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
