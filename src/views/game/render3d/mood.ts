// Time of day: each map gets a light of its own (a cool morning, a bright midday, a warm
// afternoon or a low golden evening), picked from the map seed. Sets the sun, sky light,
// reflections, haze and water colour.
import * as THREE from 'three';
import { mulberry32 } from '../../../util/math.ts';

export interface Mood {
  name: string;
  /** sun colour, strength, compass bearing it shines from (radians, 0 = from the south) and height (radians) */
  sun: string; sunI: number; bearing: number; height: number;
  /** sky light from above and bounce light from the ground */
  sky: string; ground: string; hemiI: number;
  /** reflected sky: zenith, horizon and the glow round the sun */
  zenith: string; horizon: string; glow: string; envI: number;
  /** distant haze */
  haze: string;
  water: string;
  exposure: number;
}

export const MOODS: Mood[] = [
  {
    name: 'morning', sun: '#ffe2bc', sunI: 2.3, bearing: -2.1, height: 0.62,
    sky: '#cfe2ff', ground: '#4a5034', hemiI: 0.55, zenith: '#5d8fd0', horizon: '#dfe8ee', glow: '#ffd7a0', envI: 0.55,
    haze: '#9fb2c4', water: '#2a6488', exposure: 1.0,
  },
  {
    name: 'midday', sun: '#fff6e6', sunI: 2.6, bearing: -0.6, height: 1.0,
    sky: '#d6ebff', ground: '#4d5634', hemiI: 0.6, zenith: '#3f7fd0', horizon: '#d8e6f2', glow: '#fff4dc', envI: 0.6,
    haze: '#a8bfd4', water: '#24648f', exposure: 1.0,
  },
  {
    name: 'afternoon', sun: '#ffe0a8', sunI: 2.5, bearing: 0.75, height: 0.72,
    sky: '#dce6f4', ground: '#55553a', hemiI: 0.55, zenith: '#4a80c4', horizon: '#ece4d4', glow: '#ffd890', envI: 0.55,
    haze: '#b8b8b0', water: '#2a5f86', exposure: 1.02,
  },
  {
    name: 'evening', sun: '#ffb070', sunI: 2.5, bearing: 1.35, height: 0.38,
    sky: '#c4c8e8', ground: '#5a4a34', hemiI: 0.5, zenith: '#3c5a9a', horizon: '#f0c8a0', glow: '#ff9a50', envI: 0.5,
    haze: '#c09a88', water: '#2e5478', exposure: 1.05,
  },
];

/** The light for a map: `?mood=name` overrides the seed's choice. */
export function moodFor(seed: number, name?: string | null): Mood {
  return MOODS.find((m) => m.name === name) ?? MOODS[Math.floor(mulberry32(seed * 31 + 7)() * MOODS.length)];
}

/** Direction the sunlight comes from (unit vector, scene axes). */
export function sunDirection(m: Mood): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(m.bearing) * Math.cos(m.height), Math.sin(m.height), Math.cos(m.bearing) * Math.cos(m.height));
}

/** A small sky dome to light glossy surfaces with: blue above, pale at the horizon, a glow round the sun. */
export function skyEnvironment(renderer: THREE.WebGLRenderer, m: Mood): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      zenith: { value: new THREE.Color(m.zenith) }, horizon: { value: new THREE.Color(m.horizon) },
      glow: { value: new THREE.Color(m.glow) }, ground: { value: new THREE.Color(m.ground) }, sunDir: { value: sunDirection(m) },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 zenith, horizon, glow, ground, sunDir; varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, zenith, pow(y, 0.6)) : mix(horizon, ground, min(1.0, -y * 4.0));
        float s = max(0.0, dot(normalize(vDir), sunDir));
        c += glow * (pow(s, 8.0) * 0.6 + pow(s, 200.0) * 6.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.02).texture;
  pm.dispose();
  return tex;
}
