import { describe, expect, it } from 'vitest';
import { VOICE_TRAINING_PROMPTS } from '../src/shared/voice-training-prompts';

const corpus = VOICE_TRAINING_PROMPTS.join(' ').toLowerCase();
const words = corpus.match(/[a-z]+(?:-[a-z]+)*/g) ?? [];

describe('voice training prompt corpus', () => {
  it('contains a substantial and varied reading set', () => {
    expect(VOICE_TRAINING_PROMPTS).toHaveLength(40);
    expect(new Set(words).size).toBeGreaterThanOrEqual(250);
  });

  it.each([
    ['th contrasts', /thought the weather.*meet there.*three/],
    ['sibilants and affricates', /chose.*fresh salad.*shared.*chips.*children/],
    ['soft g and j', /george adjusted his jacket.*orange badge/],
    ['zh sound', /vision.*beige.*casual/],
    ['r and l', /laura rarely.*rural railroad.*long ride.*valley/],
    ['clusters', /strong spring breeze.*scraps.*street.*brick crossing/],
    ['vowel and diphthong variety', /boy.*coin.*loud brown owl.*rain.*house/],
  ])('covers %s', (_name, pattern) => {
    expect(corpus).toMatch(pattern);
  });

  it('covers inflectional and derivational morphology', () => {
    expect(corpus).toMatch(/watched.*washed.*played.*needed/);
    expect(corpus).toMatch(/cats, dogs, horses, judges, and foxes/);
    expect(corpus).toMatch(/rebuilding.*reorganizing.*reconsidering/);
    expect(corpus).toMatch(/disagreement.*misinterpretation.*unhelpfulness.*overconfidence/);
  });

  it('covers ARIA commands and spoken numbers', () => {
    expect(corpus).toMatch(/open github.*search.*read.*aloud/);
    expect(corpus).toMatch(/scroll down.*zoom in.*copy.*previous page/);
    expect(corpus).toMatch(/focus timer.*shopping list/);
    expect(corpus).toMatch(/zero, one, two, three, four, five, six, seven, eight, nine, ten/);
  });

  it('includes natural requests for ARIA features and transcript correction', () => {
    expect(corpus).toMatch(/keep listening while i talk.*show the words/);
    expect(corpus).toMatch(/choose which microphone.*remember that setting/);
    expect(corpus).toMatch(/correct the transcript before it is saved/);
  });
});
