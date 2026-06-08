# Training ARIA - Reinforcement Learning Guide

This guide explains how to train and improve ARIA's neural networks through reinforcement learning feedback.

## Quick Start: Voice Intent Training (Desktop)

1. **Pretrain**: `npm run train:voice`
2. **Run ARIA**: `./aria.sh` (starts Electron in the background)
3. **Open controls**: Press `Ctrl+Space` (`Cmd+Space` on macOS)
4. **Enable Training**: Speak a command (e.g., "scroll down")
5. **Reward**: Press **Cmd/Ctrl+Shift+Y** if the action was correct
6. **Punish**: Press **Cmd/Ctrl+Shift+N** if the action was wrong
7. **Auto-Retrain**: Model retrains automatically 5 seconds after feedback

The desktop `Fine-tune NN` button uses the same complete seed artifact as the
headless trainer. If no corrections have been collected, it reports the bundled
validation accuracy instead of retraining. Use `Cmd/Ctrl+Shift+Y` and
`Cmd/Ctrl+Shift+N` to collect useful feedback first.

## Speech Recognition Dataset

Use `Build Voice Dataset` in ARIA Desktop to collect personal acoustic training
data. Read the displayed sentence exactly, press `Stop and compare`, and review
the reference text, Whisper transcript, and word-match score. Correct the
`Words actually spoken` field if you skipped, changed, or misread anything, then
press `Save recording`. Audio and corrected labels are stored in
`Documents/ARIA Voice Training`; transcript content is not written to the
runtime diagnostic log.

## Understanding the RL Feedback Loop

### Reward (Cmd/Ctrl+Shift+Y)
- Stores the command + correct action as a positive example
- Adds 1 unit of training weight
- Signal: "I did the right thing"

### Punish (Cmd/Ctrl+Shift+N)
- Stores the command + wrong action as a **negative example** (isCorrect=false)
- Adds 5 units of training weight (upweighted for importance)
- Signal: "This prediction was wrong; avoid it"

### Training Process
1. Negative examples are upweighted 5x during training
2. Model learns to:
   - Recognize commands that trigger false positives
   - Avoid the wrong prediction for that specific command
   - Balance between positive and negative examples

**Example:**
- User says: "click here"
- Model predicts: `scroll` (wrong!)
- User punishes (Cmd/Ctrl+Shift+N)
- Model stores: `("click here" → scroll, isCorrect=false)`
- Training upweights this example, forcing model to predict anything BUT `scroll` for "click here"

## Hyperparameter Tuning (Automatic)

Training automatically adapts to your dataset size:

| Dataset Size | Epochs | Batch Size | Expected Behavior |
|---|---|---|---|
| 50 examples | 40 | 8 | Fast training, may underfit |
| 200 examples | 60 | 16 | Balanced |
| 500 examples | 100 | 32 | Good convergence |
| 1000+ examples | 200 | 32 | Deep learning, slower but better accuracy |

**Formula:**
- Epochs: `min(200, max(40, dataset_size * 0.15))`
- Batch size: `min(32, max(4, dataset_size / 4))`
- Validation split: about 20% from each intent class (held out before final full-corpus fitting)

## Interpreting Training Results

After each training cycle, you'll see:

```
NN updated — accuracy 85% (validation: 78%)
```

### Accuracy Metrics
- **Training accuracy**: Performance on the data you trained on
- **Validation accuracy**: Performance on held-out 20% of data
- **Gap**: If train > validation by >10%, the model is overfitting

### Measured example (reproducible)

Run `npm run eval:intent` from the repo root. It trains the classifier on
`SEED_DATA` only, then evaluates the rule-router + classifier pipeline
against `examples.training.json` as a held-out set (excluding any entries
that are verbatim `SEED_DATA` duplicates, since those aren't held-out).
Last run on this repo:

```
Excluded 12/22 examples.training.json entries because they are verbatim
SEED_DATA commands (not held-out).
Held-out examples: 10
Overall accuracy: 10/10 = 100.0%
```

### Data quality fix: "scroll down" label conflict

`examples.training.json` used to contain "scroll down" twice with two
different `actionType` labels (`scroll` once, `click` once, both marked
`isCorrect: false`) — a genuine label conflict that caps achievable accuracy
below 100% on that command regardless of model quality. `scroll down` already
matches `command-classifier.ts`'s own `SEED_DATA` ground truth of
`scroll`, so both entries were corrected to `actionType: "scroll"` with
`isCorrect: true`. (Both instances happen to be excluded from `eval:intent`'s
held-out set anyway, since they're verbatim `SEED_DATA` duplicates — but the
raw file itself was previously self-contradictory, which would corrupt any
consumer that trains directly on it, e.g. `train-voice-model.ts`.)

Read that as a smoke-test, not a benchmark: 10 held-out commands spread
thinly across up to 20 action classes is too small a sample to bound a
real accuracy number. It does confirm the rule router and classifier
agree with the labels on every command that wasn't already memorized —
rerun the script after adding more `examples.training.json` entries to
get a tighter estimate.

### Per-Class Metrics (Future)
Coming soon: precision, recall, and F1 score per action class. This will show you:
- Which action classes are hardest to predict
- Where to collect more training examples

## Best Practices for Training

### 1. Start Small, Build Gradually
- Don't record 500 examples in one session
- Record 10-20 examples, train, test for a week
- Then add more based on failure modes

### 2. Balance Your Data
- Try to have similar numbers of examples per action class
- If 'click' has 100 examples and 'highlight' has 5, model will bias toward 'click'
- Record more corrections for weak classes

### 3. Seed Data is Your Baseline
- Model ships with ~15 seed examples per action
- Your corrections should reinforce or fix edge cases
- You don't need to re-teach 'scroll down' → scroll

### 4. Expect Convergence Plateaus
- First 20 corrections: big accuracy gains (50% → 70%)
- Next 50 corrections: steady gains (70% → 80%)
- After 100 corrections: diminishing returns (80% → 85%)

### 5. Test Across Websites
- Train on one website, test on another
- If accuracy drops significantly, your model is memorizing, not generalizing
- Add diverse examples from different contexts

## Reproducible Training (Advanced)

If you want exactly reproducible models for testing:

```javascript
const config = { seed: 12345 }; // Same seed = same model
await trainClassifier(examples, config);
```

This enables:
- A/B testing model versions
- Debugging specific training runs
- Sharing reproducible scenarios

## Troubleshooting

### "Accuracy stuck at 50%"
- **Cause**: Model predicts every command as the same action
- **Fix**: 
  1. Clear training data and start fresh
  2. Check that you're mixing positive and negative examples
  3. Try with explicit seed=42 to reproduce the issue

### "Validation accuracy much lower than training accuracy"
- **Cause**: Model is overfitting (memorizing training data)
- **Fix**:
  1. Reduce epochs (disable auto-tuning, set epochs=20)
  2. Add more diverse examples
  3. Check for duplicate examples in training data

### "Model accuracy improved but still wrong in real use"
- **Cause**: You trained on specific domains, test cases from different domains
- **Fix**: Record corrections in a variety of contexts (different websites, different wording)

### "Training is very slow"
- **Cause**: Large dataset (1000+ examples) and high epochs (150+)
- **Fix**:
  1. It's normal—just wait (5-10 minutes)
  2. Or manually set epochs=50 for faster, less accurate models

## Advanced: Eye Gaze & Hand Gesture Training

Eye and hand models use supervised learning, not RL:

### Eye Gaze Calibration
1. Click **Calibrate** button
2. Look at 9 dots across the screen (2 seconds each)
3. Model learns your iris-to-cursor mapping
4. Personalized to your face, camera height, screen

### Hand Gesture Training
1. Click **Train Gesture**
2. Show each gesture for 2 seconds:
   - Point, pinch, open palm, fist, peace, thumbs_up, thumbs_down
3. Model learns your hand landmarks

These are NOT RL-based; they use supervised learning with immediate retraining.

## Data Storage & Privacy

- **Where**: Examples stored in browser localStorage (desktop) or chrome.storage (extension)
- **Encrypted at rest**: API keys are AES-GCM encrypted
- **Training data**: NOT encrypted (local only, no transmission)
- **Export**: (Coming soon) Download your training data as JSON

## FAQ

**Q: Can I export my trained model?**
A: Not yet. Models are stored as TensorFlow.js weights in browser storage. Future version will support model export.

**Q: Does training data ever leave my machine?**
A: No. Training runs entirely offline. Only the Claude API requests (for new commands) involve network.

**Q: How many examples do I need?**
A: 
- 20-50: Baseline (will be noisy)
- 50-200: Good (solid accuracy)
- 200-500: Great (most real-world use)
- 500+: Excellent (approaching human performance)

**Q: What if I want to reset and retrain from scratch?**
A: Click **Clear data** button in the popup. Your training data will be deleted permanently. Then start fresh with new corrections.

**Q: Can I train a global model for everyone?**
A: Not yet. Each user trains their own personalized model. Future versions may support collaborative training.

---

**Last updated**: 2026-06-16
**Model version**: TensorFlow.js CPU backend
**Seed data**: ~15 examples × 20 action classes
