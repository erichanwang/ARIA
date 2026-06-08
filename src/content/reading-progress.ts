/**
 * Thin reading-progress bar at the top of the viewport.
 * Fills proportionally as the user scrolls through the page.
 * Toggled by commands or auto-enabled on article/blog pages.
 */

let bar: HTMLDivElement | null = null;
let rafId: number | null = null;

export function mountReadingProgress(): () => void {
  if (bar) return () => unmount();

  bar = document.createElement('div');
  bar.id = 'aria-reading-progress';
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'height:3px', 'z-index:2147483644',
    'background:linear-gradient(90deg,#ff2b2b,#9b6bff)', 'width:0%',
    'transition:width 0.1s linear', 'pointer-events:none',
  ].join(';');
  document.documentElement.appendChild(bar);

  const update = () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    const pct = total > 0 ? Math.min(100, (window.scrollY / total) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;
    rafId = requestAnimationFrame(update);
  };
  rafId = requestAnimationFrame(update);

  return unmount;
}

function unmount(): void {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  bar?.remove();
  bar = null;
}

export function isReadingProgressMounted(): boolean {
  return bar !== null;
}
