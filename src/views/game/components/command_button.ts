import { keyLabel } from '../keyboard.ts';

export interface Command {
  id: string;
  label: string;
  hotkey: string;
  icon: string;
  tip: string;
  cost?: { g: number; w: number };
  disabled?: boolean;
  /** a setting that is currently on (a unit's stance) */
  active?: boolean;
  /** buttons sharing a group are drawn joined as one pick-one bar under this caption */
  group?: string;
}

export function costText(cost: { g: number; w: number }): string {
  return `${cost.g}g${cost.w ? ` ${cost.w}w` : ''}`;
}

/** The card's buttons; a run of buttons in the same group is joined into one segmented bar. */
export function commandsHtml(list: Command[]): string {
  let out = '';
  for (let i = 0; i < list.length; ) {
    const g = list[i].group;
    if (!g) { out += commandButtonHtml(list[i], i); i++; continue; }
    let seg = '';
    for (; i < list.length && list[i].group === g; i++) seg += commandButtonHtml(list[i], i, true);
    out += `<div class="command-group" role="group" aria-label="${g}"><span class="command-group-caption">${g}</span><div class="command-group-bar">${seg}</div></div>`;
  }
  return out;
}

/** A square HUD button: icon, hotkey, name and (optionally) cost. */
export function commandButtonHtml(c: Command, index: number, segment = false): string {
  // line glyphs are inline SVG in the text colour; pictures (a building's group) are a background
  const glyph = c.icon.startsWith('<svg') ? c.icon : '', bg = glyph ? '' : ` style="background-image:url(${c.icon})"`;
  const cost = c.cost ? `<span class="command-button-cost">${costText(c.cost)}</span>` : '';
  return (
    `<button type="button" class="command-button${segment ? ' command-button--segment' : ''}${c.active ? ' command-button--active' : ''}" data-index="${index}" ${c.disabled ? 'disabled' : ''} ` +
    `${c.active != null ? `aria-pressed="${c.active}" ` : ''}` +
    `aria-label="${c.label}"${c.hotkey ? ` aria-keyshortcuts="${c.hotkey}"` : ''}${bg}>${glyph}` +
    `<span class="command-button-key" aria-hidden="true">${keyLabel(c.hotkey)}</span><span class="command-button-label">${c.label}</span>${cost}</button>`
  );
}
