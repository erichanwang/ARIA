function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const expected = words(reference);
  const actual = words(hypothesis);
  if (expected.length === 0) return actual.length === 0 ? 0 : 1;
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row++) {
    const current = [row];
    for (let column = 1; column <= actual.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + Number(expected[row - 1] !== actual[column - 1]),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[actual.length] / expected.length;
}
