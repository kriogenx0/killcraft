import type { Price } from '../../../game/production.ts';

const RES = ['ore', 'wood', 'oil', 'aether'] as const;

/** "2000 ore, 200 wood" */
export const priceText = (p: Price): string => RES.filter((k) => p[k] > 0).map((k) => `${p[k]} ${k === 'aether' ? 'Aether' : k}`).join(', ');

/** A sidebar production button for one structure, unit type or age of research. */
export function buildCellHtml(type: string, name: string, price: Price, icon: string, desc = ''): string {
  const cost = RES.filter((k) => k === 'ore' || price[k] > 0).map((k) => `<i class="build-cell-res build-cell-res--${k}" aria-hidden="true"></i>${price[k]}`).join(' ');
  const text = priceText(price);
  return (
    `<div class="build-cell" data-type="${type}">` +
    `<button type="button" class="build-cell-main" aria-label="${name}, ${text}" title="${name} · ${text}${desc ? ` · ${desc}` : ''}" style="background-image:url(${icon})">` +
    `<span class="build-cell-progress"></span><span class="build-cell-name">${name}</span><span class="build-cell-cost">${cost}</span>` +
    `<span class="build-cell-status"></span><span class="build-cell-count"></span></button>` +
    `<button type="button" class="build-cell-cancel" aria-label="Cancel ${name}" title="Cancel">×</button></div>`
  );
}
