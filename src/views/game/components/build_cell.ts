import type { Price } from '../../../game/production.ts';

const RES = ['ore', 'wood', 'oil', 'aether'] as const;

/** "2000 ore, 200 wood" */
export const priceText = (p: Price): string => RES.filter((k) => p[k] > 0).map((k) => `${p[k]} ${k === 'aether' ? 'Aether' : k}`).join(', ');

/**
 * A sidebar production button for one structure, unit type or age of research. `hotkey` works while
 * `producer` (the building that makes it) is selected.
 */
export function buildCellHtml(type: string, name: string, price: Price, icon: string, desc = '', hotkey = '', producer = ''): string {
  const cost = RES.filter((k) => price[k] > 0 || (k === 'ore' && RES.every((r) => price[r] <= 0))).map((k) => `<i class="build-cell-res build-cell-res--${k}" aria-hidden="true"></i>${price[k]}`).join(' ');
  const text = priceText(price);
  const keyTip = hotkey ? ` · Hotkey ${hotkey.split(' ').join(' then ')}${producer ? ` with the ${producer} selected` : ''}` : '';
  return (
    `<div class="build-cell" data-type="${type}">` +
    `<button type="button" class="build-cell-main" aria-label="${name}, ${text}"${hotkey ? ` aria-keyshortcuts="${hotkey}"` : ''} title="${name} · ${text}${desc ? ` · ${desc}` : ''}${keyTip}" style="background-image:url(${icon})">` +
    `<span class="build-cell-progress"></span><span class="build-cell-name">${name}</span><span class="build-cell-cost">${cost}</span>` +
    `${hotkey ? `<kbd class="build-cell-key" aria-hidden="true">${hotkey}</kbd>` : ''}<span class="build-cell-status"></span><span class="build-cell-count"></span></button>` +
    `<button type="button" class="build-cell-cancel" aria-label="Cancel ${name}" title="Cancel">×</button></div>`
  );
}
