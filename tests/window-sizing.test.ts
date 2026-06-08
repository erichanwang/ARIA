import { describe, expect, it } from 'vitest';
import { fitWindowHeight } from '../electron/src/window-sizing';

describe('desktop window sizing', () => {
  it('fits the requested content height', () => {
    expect(fitWindowHeight(514.2, 1080)).toBe(515);
  });

  it('keeps the window usable and inside the work area', () => {
    expect(fitWindowHeight(100, 1080)).toBe(220);
    expect(fitWindowHeight(2000, 900)).toBe(852);
  });
});
