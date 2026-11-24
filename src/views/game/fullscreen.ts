// Full screen: tried when a game starts (browsers allow it only right after a tap, click or key, so
// if the first try is refused it waits for the next one), and a topbar button to toggle it.
// Browsers without it (iPhone Safari) just don't show the button.

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as FsDoc;

export const ENTER_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1h4v1.5H2.5V5H1zM7 1h4v4H9.5V2.5H7zM1 7h1.5v2.5H5V11H1zM9.5 7H11v4H7V9.5h2.5z"/></svg>';
export const EXIT_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 1H5v4H1V3.5h2.5zM7 1h1.5v2.5H11V5H7zM1 7h4v4H3.5V8.5H1zM7 7h4v1.5H8.5V11H7z"/></svg>';

export function fullscreenSupported(): boolean {
  return !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

/** Ask for full screen; resolves to whether it worked. Never throws. */
export async function enterFullscreen(): Promise<boolean> {
  if (!fullscreenSupported() || isFullscreen()) return isFullscreen();
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch { /* refused: not right after a gesture, or not allowed here */ }
  return isFullscreen();
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  } catch { /* already out */ }
}

export function toggleFullscreen(): void {
  void (isFullscreen() ? exitFullscreen() : enterFullscreen());
}

let waiting: (() => void) | null = null;

/** A game is starting: go full screen now if the browser allows it, else on the next tap, click or key. */
export function autoFullscreen(): void {
  if (!fullscreenSupported() || isFullscreen() || waiting) return;
  void enterFullscreen().then((ok) => {
    if (ok || waiting) return;
    // pointerup and keydown are the events that count as a user gesture for full screen
    const tryAgain = () => { stop(); void enterFullscreen(); };
    const stop = () => {
      window.removeEventListener('pointerup', tryAgain, true);
      window.removeEventListener('keydown', tryAgain, true);
      waiting = null;
    };
    waiting = stop;
    window.addEventListener('pointerup', tryAgain, true);
    window.addEventListener('keydown', tryAgain, true);
  });
}

/** Wire a toggle button: hidden where full screen isn't available, icon follows the state. */
export function mountFullscreenButton(btn: HTMLButtonElement): void {
  if (!fullscreenSupported()) { btn.hidden = true; return; }
  const show = () => {
    const on = isFullscreen();
    btn.innerHTML = on ? EXIT_ICON : ENTER_ICON;
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    btn.title = on ? 'Exit full screen (F11)' : 'Full screen';
  };
  show();
  btn.addEventListener('click', () => { waiting?.(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', show);
  document.addEventListener('webkitfullscreenchange', show);
}
