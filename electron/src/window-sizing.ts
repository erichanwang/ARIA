export function fitWindowHeight(contentHeight: number, workAreaHeight: number): number {
  const requested = Number.isFinite(contentHeight) ? Math.ceil(contentHeight) : 380;
  return Math.max(220, Math.min(requested, workAreaHeight - 48));
}
