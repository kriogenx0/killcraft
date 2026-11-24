// A small clipboard icon button: copies some text and briefly shows a tick.

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DONE_TIME = 1500;

/** Copy text to the clipboard. Falls back to a hidden text box where the async clipboard isn't allowed. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* try the old way */ }
  const box = document.createElement('textarea');
  box.value = text;
  box.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
  box.remove();
  return ok;
}

/** Turn a button into a copy button for whatever `text()` returns when clicked. */
export function setupCopyButton(btn: HTMLButtonElement, text: () => string, label: string): HTMLButtonElement {
  btn.type = 'button';
  btn.classList.add('ui-copy');
  btn.innerHTML = COPY_ICON;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  let timer = 0;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(text());
    btn.innerHTML = ok ? DONE_ICON : COPY_ICON;
    btn.title = ok ? 'Copied!' : "Couldn't copy";
    clearTimeout(timer);
    timer = window.setTimeout(() => { btn.innerHTML = COPY_ICON; btn.title = label; }, DONE_TIME);
  });
  return btn;
}

export function copyButton(text: () => string, label: string): HTMLButtonElement {
  return setupCopyButton(document.createElement('button'), text, label);
}
