#!/usr/bin/env node
/**
 * Download ARIA's external ML assets (Porcupine params, MediaPipe models)
 * Works cross-platform (Windows, macOS, Linux)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);
const publicDir = path.join(rootDir, 'public');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function download(url, targetPath) {
  return new Promise((resolve, reject) => {
    // Skip if already exists
    if (fs.existsSync(targetPath)) {
      console.log(`   [ok] ${path.basename(targetPath)} already exists`);
      resolve();
      return;
    }

    console.log(`   Downloading ${path.basename(targetPath)}...`);
    https.get(url, (response) => {
      if (response.statusCode === 404 || response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }

      const fileStream = fs.createWriteStream(targetPath);
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading ARIA external assets...\n');

  try {
    // 1. Porcupine wake word model
    console.log('1. Porcupine wake word model...');
    const porcupineDir = path.join(publicDir, 'porcupine-model');
    fs.mkdirSync(porcupineDir, { recursive: true });

    try {
      await download(
        'https://cdn.picovoice.ai/models/porcupine/porcupine_params.pv',
        path.join(porcupineDir, 'porcupine_params.pv'),
      );
    } catch (e) {
      console.log(`   [warn] Could not download Porcupine params: ${e.message}`);
      console.log('   [info] Voice mode will work but wake word detection may be limited');
      console.log('   See: https://picovoice.ai/docs/quick-start/porcupine/');
    }

    // 2. MediaPipe WASM runtime
    console.log('\n2. MediaPipe WASM runtime...');
    const mpWasmDir = path.join(publicDir, 'mediapipe-wasm');
    fs.mkdirSync(mpWasmDir, { recursive: true });

    const mpVersion = '0.10.14';
    const mpBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mpVersion}/wasm`;
    const mpFiles = [
      'vision_wasm_internal.js',
      'vision_wasm_internal.wasm',
    ];

    for (const file of mpFiles) {
      try {
        await download(
          `${mpBase}/${file}`,
          path.join(mpWasmDir, file),
        );
        await sleep(500); // Rate limiting
      } catch (e) {
        console.log(`   [warn] Could not download ${file}: ${e.message}`);
        console.log('   [info] Eye and hand tracking will not work');
        console.log('   See: https://developers.google.com/mediapipe');
      }
    }

    // 3. Face and hand landmark task models
    console.log('\n3. MediaPipe task models (face & hand landmarkers)...');
    console.log('   [info] These will be downloaded on-demand from Google CDN');
    console.log('   [info] Requires internet connection for first use');

    // 4. Whisper STT model + ONNX Runtime wasm. Same model/dtype the desktop
    //    app and `npm run eval:stt` use. Vendored so the offscreen document
    //    never fetches weights or wasm from a CDN (extension CSP forbids it).
    console.log('\n4. Whisper speech-to-text model (onnx-community/whisper-base.en)...');
    const whisperDir = path.join(publicDir, 'models', 'whisper-base.en');
    fs.mkdirSync(path.join(whisperDir, 'onnx'), { recursive: true });
    const hfBase = 'https://huggingface.co/onnx-community/whisper-base.en/resolve/main';
    const whisperFiles = [
      'config.json', 'generation_config.json', 'preprocessor_config.json',
      'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json',
      'added_tokens.json', 'vocab.json', 'merges.txt', 'normalizer.json',
      'onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx',
    ];
    try {
      for (const file of whisperFiles) {
        await download(`${hfBase}/${file}`, path.join(whisperDir, file));
      }
    } catch (e) {
      console.log(`   [warn] Could not download Whisper model: ${e.message}`);
      console.log('   [info] Voice commands will not work without it');
    }
    const ortDir = path.join(publicDir, 'ort');
    fs.mkdirSync(ortDir, { recursive: true });
    for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
      const src = path.join(rootDir, 'node_modules', 'onnxruntime-web', 'dist', file);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ortDir, file));
      else console.log(`   [warn] ${file} not found in node_modules/onnxruntime-web`);
    }

    console.log('\n[ok] Asset download complete!\n');
    console.log('Summary:');
    console.log('   • Porcupine params: Wake word detection');
    console.log('   • MediaPipe WASM: Eye/hand tracking (CPU)');
    console.log('   • Landmark models: Downloaded from CDN on first use');
    console.log('   • Whisper + ORT wasm: On-device speech-to-text\n');
    console.log('Ready to use ARIA!');
    console.log('   Run: npm run dev  (for development with HMR)');
    console.log('   Or:  npm run build && npx electron . (for desktop app)');
  } catch (error) {
    console.error('[fail] Error downloading assets:', error.message);
    process.exit(1);
  }
}

main();
