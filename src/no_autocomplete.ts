// No browser autocomplete, autofill, autocorrect, auto-capitalising or spellcheck on any field in
// the game. The fields set it themselves; this also catches any field added later.

const OFF: Record<string, string> = { autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false' };

export function blockAutocomplete(): void {
  const fix = (el: EventTarget | null) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
    for (const [k, v] of Object.entries(OFF)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  };
  document.querySelectorAll('input, textarea').forEach(fix);
  document.addEventListener('focusin', (ev) => fix(ev.target), true);
}
