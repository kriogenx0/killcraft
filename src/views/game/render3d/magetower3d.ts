// The Mage Tower, where a side's spellcasters learn their craft. Every age it is a tall round tower
// under a steep violet roof with a glowing crystal turning over its peak (the `rune` part), so it
// reads as magic at a glance and never as the square Watchtower.
import * as THREE from 'three';
import { group, mesh, rot, type Mat, type Model, type Parts } from './model_kit.ts';
import { M, box, cone, cyl, octa, sph, teamMat, torus, mat } from './materials.ts';

const violet = () => mat('#4a2a7a', { rough: 0.65 });
const deepViolet = () => mat('#2e1a52', { rough: 0.7 });
const crystal = () => mat('#a8e0ff', { rough: 0.15, metal: 0.2, emissive: '#3aa0ff', emissiveIntensity: 1.6, flat: true });
const glow = () => mat('#d0b8ff', { rough: 0.4, emissive: '#8a50ff', emissiveIntensity: 1.2 });

/**
 * look 0: rubble stone and timber (Medieval); look 1: dressed stone; look 3: concrete, steel and
 * glass (Modern). World War is look 3 run through `industrial()` in models.ts (brick and iron).
 */
export function mageTower(team: number, lk: 0 | 1 | 3): Model {
  const root = new THREE.Group(), parts: Parts = {}, tm = teamMat(team), modern = lk === 3;
  const wall: Mat = modern ? M.concrete() : lk === 1 ? M.dressedStone() : M.stone();
  const trim: Mat = modern ? M.lightConcrete() : M.darkStone();
  // the ground: a poured pad, or packed earth
  const pad = mesh(box(1.94, 0.06, 1.94), modern ? M.concrete() : M.dirt(), 0, 0.03, 0);
  pad.name = 'pad';
  root.add(pad);
  // a ring of five rune stones around the tower's foot, each with a glowing mark
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2 + 0.35, x = 0.1 + Math.cos(a) * 0.78, z = -0.05 + Math.sin(a) * 0.78;
    if (Math.abs(x) > 0.9 || Math.abs(z) > 0.9) continue;
    const s = group(x, 0, z, mesh(box(0.1, 0.26, 0.07), modern ? M.steel() : M.darkStone(), 0, 0.15, 0), mesh(box(0.04, 0.08, 0.075), glow(), 0, 0.18, 0));
    s.rotation.y = -a + Math.PI / 2;
    root.add(s);
  }
  // the tower: a stepped plinth, a tall round shaft, a corbelled gallery
  const cx = 0.1, cz = -0.05, r = 0.42, h = 1.5;
  root.add(mesh(cyl(r + 0.1, r + 0.14, 0.14, 20), trim, cx, 0.13, cz));
  root.add(mesh(cyl(r, r + 0.04, h, 20), wall, cx, 0.2 + h / 2, cz));
  root.add(mesh(cyl(r + 0.01, r + 0.01, 0.07, 20), tm, cx, 0.2 + h * 0.62, cz));
  root.add(mesh(cyl(r + 0.1, r, 0.1, 20), trim, cx, 0.2 + h + 0.05, cz));
  // arched door and slit windows on the side facing the camera (+z)
  root.add(mesh(box(0.2, 0.3, 0.03), M.darkWood(), cx, 0.38, cz + r + 0.02));
  root.add(mesh(new THREE.CircleGeometry(0.1, 10, 0, Math.PI), M.darkWood(), cx, 0.53, cz + r + 0.035));
  for (const [y, dx] of [[0.95, 0], [1.3, -0.17], [1.3, 0.17]] as const) {
    const a = dx / r;
    root.add(rot(mesh(box(0.06, 0.16, 0.03), modern ? M.glass() : glow(), cx + Math.sin(a) * (r + 0.01), y, cz + Math.cos(a) * (r + 0.01)), 0, a, 0));
  }
  // the roof: a steep violet cone (a glass and steel crown in the Modern age) with a team band
  const top = 0.2 + h + 0.1;
  if (modern) {
    root.add(mesh(cyl(r - 0.04, r + 0.06, 0.3, 20), M.glass(), cx, top + 0.15, cz));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      root.add(mesh(box(0.03, 0.3, 0.03), M.steel(), cx + Math.cos(a) * (r + 0.02), top + 0.15, cz + Math.sin(a) * (r + 0.02)));
    }
    root.add(mesh(cone(r + 0.02, 0.55, 20), violet(), cx, top + 0.3 + 0.275, cz));
    root.add(mesh(cyl(0.02, 0.03, 0.45, 6), M.steel(), cx, top + 1.05, cz));
  } else {
    root.add(mesh(cone(r + 0.16, 0.95, 20), violet(), cx, top + 0.475, cz));
    root.add(mesh(cyl(r + 0.14, r + 0.16, 0.06, 20), tm, cx, top + 0.05, cz));
    // a little dormer with a lit window
    root.add(rot(mesh(box(0.14, 0.16, 0.14), deepViolet(), cx, top + 0.3, cz + 0.38), 0.3, 0, 0));
    root.add(mesh(box(0.07, 0.08, 0.02), glow(), cx, top + 0.3, cz + 0.46));
    root.add(mesh(cyl(0.015, 0.02, 0.3, 6), M.iron(), cx, top + 1.05, cz));
  }
  // the crystal: a turning, bobbing gem in a ring, high above everything else in the base
  const peak = top + (modern ? 1.3 : 1.25);
  const rune = group(cx, peak, cz,
    rot(mesh(octa(0.13), crystal(), 0, 0, 0), 0, 0, 0),
    rot(mesh(torus(0.2, 0.015, Math.PI * 2, 6, 24), glow(), 0, 0, 0), Math.PI / 2 - 0.35, 0, 0));
  rune.scale.set(1, 1.5, 1);
  rune.userData.y = peak;
  parts.rune = rune;
  root.add(rune);
  // a lectern with an open book and a team banner pole out front
  root.add(mesh(box(0.06, 0.26, 0.06), modern ? M.steel() : M.darkWood(), -0.62, 0.17, 0.62));
  root.add(rot(mesh(box(0.2, 0.03, 0.14), M.leather(), -0.62, 0.31, 0.62), -0.4, 0, 0));
  root.add(rot(mesh(box(0.18, 0.012, 0.12), M.white(), -0.62, 0.33, 0.625), -0.4, 0, 0));
  root.add(mesh(cyl(0.015, 0.018, 0.9, 6), modern ? M.steel() : M.darkWood(), 0.78, 0.45, 0.72));
  const flag = group(0.78, 0.82, 0.72, mesh(box(0.22, 0.14, 0.01), tm, 0.11, 0, 0));
  parts.flag = flag;
  root.add(flag);
  // a few candles or lamps by the door
  for (const dx of [-0.2, 0.2]) {
    root.add(mesh(cyl(0.025, 0.025, 0.1, 6), modern ? M.steel() : M.white(), cx + dx, 0.11, cz + r + 0.16));
    root.add(mesh(sph(0.025, 6, 4), M.lamp(), cx + dx, 0.18, cz + r + 0.16));
  }
  return { root, parts, height: peak + 0.3 };
}
