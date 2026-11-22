export interface Command {
  id: string;
  label: string;
  hotkey: string;
  icon: string;
  tip: string;
  cost?: { g: number; w: number };
  disabled?: boolean;
}

export function costText(cost: { g: number; w: number }): string {
  return `${cost.g}g${cost.w ? ` ${cost.w}w` : ''}`;
}

/** A square HUD button: icon, hotkey, name and (optionally) cost. */
export function commandButtonHtml(c: Command, index: number): string {
  const cost = c.cost ? `<span class="command-button-cost">${costText(c.cost)}</span>` : '';
  return (
    `<button type="button" class="command-button" data-index="${index}" ${c.disabled ? 'disabled' : ''} ` +
    `aria-label="${c.label}"${c.hotkey ? ` aria-keyshortcuts="${c.hotkey}"` : ''} style="background-image:url(${c.icon})">` +
    `<span class="command-button-key" aria-hidden="true">${c.hotkey}</span><span class="command-button-label">${c.label}</span>${cost}</button>`
  );
}
