// Tells the game server when a player's game runs slowly: each time the graphics step down to keep
// up (render3d/scene.ts), and now and then while frames stay slow at the lowest level. The server
// logs it (server/services/perf_monitor.ts), so slow devices and big battles show up in the logs.
import { G } from '../../game/state.ts';
import { S, onSlowFrames } from './render3d/scene.ts';
import { V } from './view_state.ts';

/** at most one report this often (ms) */
const EVERY = 30_000;
let lastSent = -Infinity, gpu: string | null = null;

function gpuName(): string {
  if (gpu !== null) return gpu;
  try {
    const gl = S.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 80);
  } catch { gpu = ''; }
  return gpu;
}

export function initPerfReport(): void {
  if (typeof fetch !== 'function' || !/^https?:$/.test(location.protocol) || import.meta.env?.DEV) return;
  onSlowFrames((from, to, fps) => {
    const now = performance.now();
    if (now - lastSent < EVERY) return;
    lastSent = now;
    const body = JSON.stringify({
      fps: Math.round(fps), quality: to, from, units: G.ents.filter((e) => e.kind === 'unit' && !e.dead).length, online: !!V.online,
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio, gpu: gpuName(), mobile: matchMedia('(pointer: coarse)').matches, ver: __APP_COMMIT__,
    });
    fetch('/perf', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  });
}
