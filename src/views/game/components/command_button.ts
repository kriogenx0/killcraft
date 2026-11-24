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
}

export function costText(cost: { g: number; w: number }): string {
  return `${cost.g}g${cost.w ? ` ${cost.w}w` : ''}`;
}

/** A square HUD button: icon, hotkey, name and (optionally) cost. */
export function commandButtonHtml(c: Command, index: number): string {
  // line glyphs are inline SVG in the text colour; pictures (a building's group) are a background
  const glyph = c.icon.startsWith('<svg') ? c.icon : '', bg = glyph ? '' : ` style="background-image:url(${c.icon})"`;
  const cost = c.cost ? `<span class="command-button-cost">${costText(c.cost)}</span>` : '';
  return (
    `<button type="button" class="command-button${c.active ? ' command-button--active' : ''}" data-index="${index}" ${c.disabled ? 'disabled' : ''} ` +
    `${c.active != null ? `aria-pressed="${c.active}" ` : ''}` +
    `aria-label="${c.label}"${c.hotkey ? ` aria-keyshortcuts="${c.hotkey}"` : ''}${bg}>${glyph}` +
    `<span class="command-button-key" aria-hidden="true">${keyLabel(c.hotkey)}</span><span class="command-button-label">${c.label}</span>${cost}</button>`
  );
}
