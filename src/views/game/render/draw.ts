// Canvas drawing primitives shared by the unit, building and icon art.
import { TAU } from '../../../util/math.ts';

type G2 = CanvasRenderingContext2D;

/** Filled ellipse with a dark outline. */
export function blob(g: G2, x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, outline = true): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  if (outline) { g.lineWidth = 1.1; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke(); }
}

/** Radial gradient lit from the top-left. */
export function shade(g: G2, x: number, y: number, r: number, light: string, dark: string): CanvasGradient {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.1);
  gr.addColorStop(0, light);
  gr.addColorStop(1, dark);
  return gr;
}

/** Line with a dark outline. */
export function oline(g: G2, x0: number, y0: number, x1: number, y1: number, w: number, c: string): void {
  g.lineCap = 'round';
  g.lineWidth = w + 2; g.strokeStyle = 'rgba(0,0,0,.75)';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.lineWidth = w; g.strokeStyle = c;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

export function ellipseFill(g: G2, x: number, y: number, rx: number, ry: number, fill: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
  g.fill();
}
