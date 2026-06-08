#!/usr/bin/env node
/**
 * ARIA batch training CLI
 * Train ARIA's neural networks from command-line with pre-recorded examples
 *
 * Usage:
 *   npx node scripts/train-cli.mjs --examples examples.json --output model.weights.json
 *   npx node scripts/train-cli.mjs --examples examples.json --epochs 100 --batch-size 16
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Note: This is a simple CLI wrapper. In production, you'd want to:
// 1. Import TensorFlow.js and the actual training code
// 2. Support different output formats (SavedModel, TFLite, etc.)
// 3. Add validation and error handling

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

// Parse command-line arguments
function parseArgs(args) {
  const result = {
    examples: null,
    output: null,
    epochs: null,
    batchSize: null,
    validationSplit: 0.2,
    seed: null,
  };

  for (let i = 2; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];

    switch (key) {
      case 'examples':
        result.examples = value;
        break;
      case 'output':
        result.output = value;
        break;
      case 'epochs':
        result.epochs = parseInt(value);
        break;
      case 'batch-size':
        result.batchSize = parseInt(value);
        break;
      case 'validation-split':
        result.validationSplit = parseFloat(value);
        break;
      case 'seed':
        result.seed = parseInt(value);
        break;
      case 'help':
      case 'h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
ARIA Batch Training CLI
========================

Train neural networks from pre-recorded examples (JSON format).

Usage:
  npx node scripts/train-cli.mjs [options]

Options:
  --examples FILE         Path to examples.json (required)
  --output FILE           Path to save trained weights (default: ./weights.json)
  --epochs N              Number of training epochs (default: auto-tune)
  --batch-size N          Batch size (default: auto-tune)
  --validation-split N    Validation set ratio (default: 0.2)
  --seed N                Random seed for reproducibility (default: none)
  --help, -h              Show this help message

Example Input (examples.json):
[
  {
    "command": "click the button",
    "actionType": "click",
    "timestamp": 1623456789000,
    "source": "claude",
    "isCorrect": true
  },
  {
    "command": "scroll down",
    "actionType": "scroll",
    "timestamp": 1623456790000,
    "source": "user",
    "isCorrect": true
  }
]

Output:
- Trained model weights (TensorFlow.js format)
- Training metrics (accuracy, loss curve)
- Per-class performance (precision, recall, F1)

Example:
  npx node scripts/train-cli.mjs \\
    --examples ./my-examples.json \\
    --output ./my-weights.json \\
    --epochs 100 \\
    --seed 42

For more info: https://github.com/erichanwang/aria/blob/main/TRAINING.md
  `);
}

async function main() {
  const args = parseArgs(process.argv);

  // Validate required arguments
  if (!args.examples) {
    console.error('❌ Error: --examples FILE is required');
    console.log('\nRun with --help for usage info');
    process.exit(1);
  }

  // Check if examples file exists
  if (!fs.existsSync(args.examples)) {
    console.error(`❌ Error: Examples file not found: ${args.examples}`);
    process.exit(1);
  }

  const outputPath = args.output || path.join(process.cwd(), 'weights.json');
  const examplesPath = path.resolve(args.examples);

  console.log('🚀 ARIA Batch Training CLI');
  console.log('==========================\n');
  console.log(`📂 Examples: ${examplesPath}`);
  console.log(`💾 Output:   ${outputPath}`);

  try {
    // Load examples
    console.log('\n📖 Loading examples...');
    const raw = fs.readFileSync(examplesPath, 'utf-8');
    const examples = JSON.parse(raw);

    if (!Array.isArray(examples)) {
      throw new Error('Examples file must contain an array of training examples');
    }

    if (examples.length === 0) {
      throw new Error('Examples array is empty');
    }

    console.log(`   ✅ Loaded ${examples.length} examples\n`);

    // Analyze data
    console.log('📊 Data Analysis:');
    const classCount = {};
    for (const ex of examples) {
      classCount[ex.actionType] = (classCount[ex.actionType] || 0) + 1;
    }
    const classes = Object.entries(classCount)
      .map(([cls, count]) => `  • ${cls}: ${count} examples`)
      .join('\n');
    console.log(classes);

    // Check for imbalance
    const counts = Object.values(classCount);
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);
    const ratio = (maxCount / minCount).toFixed(1);
    console.log(`\n  Imbalance ratio: ${ratio}:1 (max:min)`);

    // Show configuration
    console.log('\n⚙️  Training Configuration:');
    console.log(`  Epochs: ${args.epochs || 'auto-tune'}`);
    console.log(`  Batch size: ${args.batchSize || 'auto-tune'}`);
    console.log(`  Validation split: ${(args.validationSplit * 100).toFixed(0)}%`);
    if (args.seed) console.log(`  Seed: ${args.seed} (reproducible)`);

    // NOTE: Actual training would happen here
    // In a real implementation, you'd:
    // 1. Import trainClassifier from command-classifier.ts
    // 2. Call it with the examples and config
    // 3. Serialize the results

    console.log('\n📈 Training Status:');
    console.log('  ℹ️  Full training not implemented in CLI wrapper');
    console.log('  ℹ️  For now, this is a data validation and analysis tool');
    console.log('  ℹ️  To train, use the Electron app: npm run electron\n');

    console.log('✅ Data validation passed!');
    console.log('   Next: Use the Electron app to train with this data');
    console.log(`   Or implement the train-cli.mjs wrapper to call trainClassifier()\n`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
