// Command button glyphs: simple line icons drawn in the button's text colour (currentColor), so they
// read on both the dark and the light theme and match the touch bar.

const svg = (body: string, extra = ''): string =>
  `<svg class="command-button-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

const crosshair = (x: number, y: number, r: number, t: number): string =>
  `<circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x} ${y - r - t}v${t + 2}M${x} ${y + r - 2}v${t + 2}M${x - r - t} ${y}h${t + 2}M${x + r - 2} ${y}h${t + 2}"/>` +
  `<circle cx="${x}" cy="${y}" r="1.2" fill="currentColor" stroke="none"/>`;

export const COMMAND_GLYPH: Record<string, string> = {
  move: svg('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  patrol: svg('<path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/>'),
  stop: svg('<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M8 12h8"/>'),
  engage: svg(crosshair(12, 12, 6, 4)),
  skirmish: svg(`<path d="M3 19h10M10 16l3 3-3 3"/>${crosshair(15, 8.5, 4, 3)}`),
  passive: svg('<path d="M6 21V3"/><path d="M6 4h12l-3 4.5 3 4.5H6"/>'),
  // Fix, then harvest: a hammer over a nugget of ore
  tend: svg('<path d="M3.5 20.5l9-9"/><path d="M11.8 6.6l5.6 5.6-2.2 2.2-5.6-5.6z"/><path d="M19 15.5l2.5 2.5-2.5 2.5-2.5-2.5z"/>'),
  rally: svg('<path d="M6 21V3"/><path d="M6 4l13 4.5L6 13"/><path d="M3 21h7"/>'),
  follow: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  cancel: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  repair: svg('<path d="M14.5 6.5a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.6 6.6a2.1 2.1 0 0 1-3-3l6.6-6.6a6 6 0 0 1 7.9-7.9z"/>'),
  upgrade: svg('<path d="M6 12l6-6 6 6M6 19l6-6 6 6"/>'),
  scrap: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>'),
};
