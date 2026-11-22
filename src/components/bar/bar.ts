export type BarVariant = 'health' | 'progress';

/** Markup for a horizontal meter. `fraction` is 0..1. */
export function barHtml(fraction: number, variant: BarVariant = 'health', label = ''): string {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return `<div class="ui-bar ui-bar--${variant}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${label}"><div class="ui-bar-fill" style="width:${pct}%"></div></div>`;
}
