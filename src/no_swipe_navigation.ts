// Keep sideways swipes from leaving the game: a two-finger trackpad swipe (Mac) or an edge swipe
// (iPhone, iPad) would otherwise go Back or Forward, and a game lives at its own /game/<id> address.
// CSS does most of it (overscroll-behavior: none on html and body, styles/_reset.scss); this covers
// the browsers and spots it misses. Panels that really scroll sideways still scroll.

const EDGE_PX = 24;

export function blockSwipeNavigation(): void {
  window.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey || Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return;
    if (!canScrollSideways(ev.target, ev.deltaX)) ev.preventDefault();
  }, { passive: false });

  // iOS Safari's edge swipe: cancelling the touch that starts on the map at a side edge stops it.
  // Only on the map, so buttons near an edge still get their click; the map works from pointer
  // events, which fire either way.
  document.addEventListener('touchstart', (ev) => {
    const t = ev.touches[0], el = ev.target as HTMLElement | null;
    if (!t || !ev.cancelable || !el?.closest?.('.game-canvas, .game-overlay')) return;
    if (t.clientX < EDGE_PX || t.clientX > window.innerWidth - EDGE_PX) ev.preventDefault();
  }, { passive: false });
}

/** Is there an element under the pointer that can still scroll in this sideways direction? */
function canScrollSideways(target: EventTarget | null, dx: number): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    if (dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}
