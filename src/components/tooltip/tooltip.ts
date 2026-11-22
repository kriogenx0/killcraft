/** Show a tooltip element with the given markup. */
export function showTooltip(el: HTMLElement, html: string): void {
  if (el.innerHTML !== html) el.innerHTML = html;
  el.classList.add('ui-tooltip--open');
}

export function hideTooltip(el: HTMLElement): void {
  el.classList.remove('ui-tooltip--open');
}
