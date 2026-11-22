// Keep the browser from zooming the page: the game has its own camera zoom.

const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0']);

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
}
