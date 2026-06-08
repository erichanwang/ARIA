import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(process.argv[2] ?? path.join(root, '.voice-training', 'stt-fixtures'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'stt-fixtures.json'), 'utf8'));
const tts = ['espeak-ng', 'espeak'].find((command) => {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});

if (!tts) {
  console.error('FATAL: fixture generation requires espeak-ng or espeak on PATH.');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
for (const sample of manifest) {
  const wav = execFileSync(tts, ['--stdout', '-v', 'en-us', sample.text], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  fs.writeFileSync(path.join(outputDir, sample.file), wav);
}
fs.writeFileSync(path.join(outputDir, 'metadata.jsonl'), `${manifest.map((sample) => JSON.stringify(sample)).join('\n')}\n`);
console.log(`Generated ${manifest.length} deterministic TTS fixtures in ${outputDir}`);
