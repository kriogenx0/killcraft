export interface ChipOptions {
  icon: string;
  label: string;
  /** health 0..1; omitted hides the health strip */
  health?: number;
  /** data attribute name and value, used by the owner's click handler */
  data: [string, string | number];
}

/** A small icon button standing for one unit or queued item. */
export function chipHtml(o: ChipOptions): string {
  const hp = o.health === undefined ? '' : `<span class="ui-chip-health"><span style="width:${Math.round(o.health * 100)}%"></span></span>`;
  return `<button type="button" class="ui-chip" data-${o.data[0]}="${o.data[1]}" aria-label="${o.label}" title="${o.label}" style="background-image:url(${o.icon})">${hp}</button>`;
}
