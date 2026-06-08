#!/usr/bin/env bash
# ARIA Desktop Launcher
# Run from the ARIA project root: ./aria.sh

set -e
cd "$(dirname "$0")"

if ! node -e "const model=require('./electron/src/renderer/intent-model.json'); if (!model.version || !Array.isArray(model.weights)) process.exit(1)" 2>/dev/null; then
  echo "Voice model is missing or still training. Run: npm run train:voice"
  exit 1
fi

# First-run setup
if [ ! -d "electron/node_modules" ]; then
  echo "First run - installing desktop app dependencies..."
  (cd electron && npm install --silent)
  echo "Done"
fi

# Compile TypeScript if dist is missing or source is newer
if [ ! -f "electron/dist/main.js" ] || \
   find electron/src electron/package.json electron/tsconfig.json \
     electron/tsconfig.renderer.json electron/vite.config.ts \
     -type f -newer "electron/dist/main.js" -print -quit | grep -q .; then
  echo "Compiling..."
  (cd electron && npm run build --silent)
  echo "Compiled"
fi

echo "Starting ARIA Desktop..."
echo "   Ctrl+Space to activate voice"
echo "   Ctrl+Shift+Y = reward  |  Ctrl+Shift+N = punish  (Cmd on macOS)"
echo "   Close the terminal to quit"
echo ""

cd electron
npx electron . "$@"
