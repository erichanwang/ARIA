export function formatTranscriptTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, '0');
  return `[${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}]`;
}
