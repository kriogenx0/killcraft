// Keep the browser from zooming the page: the game has its own camera zoom.

const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);
const DOUBLE_TAP_MS = 300;

export function blockBrowserZoom(): void {
  // Ctrl/Cmd + wheel, which is also what a trackpad pinch sends
  window.addEventListener('wheel', (ev) => { if (ev.ctrlKey || ev.metaKey) ev.preventDefault(); }, { passive: false });
  // Ctrl/Cmd + plus, minus or zero
  window.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ZOOM_KEYS.has(ev.key)) ev.preventDefault();
  });
  // Safari pinch (it ignores user-scalable=no)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (ev) => ev.preventDefault(), { passive: false });
  // multi-finger touches that land outside the canvas
  document.addEventListener('touchmove', (ev) => { if (ev.touches.length > 1) ev.preventDefault(); }, { passive: false });
  // a second tap soon after the first would double-tap zoom on older iOS; cancel it, but still click
  // the button it landed on, so tapping Build twice quickly still queues two
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (ev) => {
    const now = ev.timeStamp, target = ev.target as HTMLElement | null;
    if (now - lastTouchEnd < DOUBLE_TAP_MS && ev.cancelable && !isTextField(target)) {
      ev.preventDefault();
      target?.closest<HTMLElement>('button, [role="button"], a')?.click();
    }
    lastTouchEnd = now;
  }, { passive: false });
  // no long-press menu, except in text fields
  document.addEventListener('contextmenu', (ev) => { if (!isTextField(ev.target as HTMLElement | null)) ev.preventDefault(); });
}

function isTextField(el: HTMLElement | null): boolean {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}
