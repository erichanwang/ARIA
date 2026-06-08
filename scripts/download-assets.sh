#!/bin/bash
# Download ARIA's external ML assets (Porcupine params, MediaPipe models)
# Run this after npm install to get all required assets for full functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$ROOT_DIR/public"

echo "📦 Downloading ARIA external assets..."
echo ""

# Porcupine wake word model
echo "1️⃣  Porcupine wake word model..."
mkdir -p "$PUBLIC_DIR/porcupine-model"
cd "$PUBLIC_DIR/porcupine-model"

if [ ! -f "porcupine_params.pv" ]; then
  # Download from Picovoice CDN
  echo "   Downloading porcupine_params.pv..."
  curl -sL "https://cdn.picovoice.ai/models/porcupine/porcupine_params.pv" \
    -o porcupine_params.pv || {
    echo "   ⚠️  Could not download Porcupine params"
    echo "   ℹ️  Voice mode will work but wake word detection may be limited"
    echo "   📖 See: https://picovoice.ai/docs/quick-start/porcupine/"
  }
else
  echo "   ✅ porcupine_params.pv already exists"
fi

cd "$ROOT_DIR"

# MediaPipe WASM runtime
echo ""
echo "2️⃣  MediaPipe WASM runtime..."
mkdir -p "$PUBLIC_DIR/mediapipe-wasm"
cd "$PUBLIC_DIR/mediapipe-wasm"

MEDIAPIPE_VERSION="0.10.14"
MEDIAPIPE_BASE="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm"

# Detect architecture
if command -v uname &> /dev/null; then
  ARCH=$(uname -m)
  if [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    WASM_ARCH="x86_64"
  elif [[ "$ARCH" == "arm64" || "$ARCH" == "aarch64" ]]; then
    WASM_ARCH="wasm_bin.wasm"
  else
    WASM_ARCH="x86_64"
  fi
else
  WASM_ARCH="x86_64"
fi

WASM_FILES=(
  "vision_wasm_internal.js"
  "vision_wasm_internal.wasm"
)

for file in "${WASM_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "   Downloading $file..."
    curl -sL "$MEDIAPIPE_BASE/$file" -o "$file" || {
      echo "   ⚠️  Could not download $file"
      echo "   ℹ️  Eye and hand tracking will not work"
      echo "   📖 See: https://developers.google.com/mediapipe"
    }
  else
    echo "   ✅ $file already exists"
  fi
done

cd "$ROOT_DIR"

# Face and hand landmark task models (optional, can be loaded from Google CDN)
echo ""
echo "3️⃣  MediaPipe task models (face & hand landmarkers)..."
echo "   ℹ️  These will be downloaded on-demand from Google CDN"
echo "   ℹ️  Requires internet connection for first use"

echo ""
echo "✅ Asset download complete!"
echo ""
echo "📝 Summary:"
echo "   • Porcupine params: Wake word detection"
echo "   • MediaPipe WASM: Eye/hand tracking (CPU)"
echo "   • Landmark models: Downloaded from CDN on first use"
echo ""
echo "🚀 You're ready to use ARIA!"
echo "   Run: npm run dev  (for development with HMR)"
echo "   Or:  npm run build && npx electron . (for desktop app)"
