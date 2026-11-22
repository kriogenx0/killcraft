/** A sidebar production button for one structure or unit type. */
export function buildCellHtml(type: string, name: string, cost: number, icon: string): string {
  return (
    `<div class="build-cell" data-type="${type}">` +
    `<button type="button" class="build-cell-main" aria-label="${name}, ${cost} credits" title="${name} · $${cost}" style="background-image:url(${icon})">` +
    `<span class="build-cell-progress"></span><span class="build-cell-name">${name}</span><span class="build-cell-cost">$${cost}</span>` +
    `<span class="build-cell-status"></span><span class="build-cell-count"></span></button>` +
    `<button type="button" class="build-cell-cancel" aria-label="Cancel ${name}" title="Cancel">×</button></div>`
  );
}
