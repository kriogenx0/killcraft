export function openModal(el: HTMLElement): void {
  el.classList.add('ui-modal--open');
  el.setAttribute('aria-hidden', 'false');
  el.querySelector<HTMLElement>('button')?.focus();
}

export function closeModal(el: HTMLElement): void {
  el.classList.remove('ui-modal--open');
  el.setAttribute('aria-hidden', 'true');
}
