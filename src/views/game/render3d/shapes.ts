// Sculpted low-poly shapes for the models: lofts through cross-sections (torsos, limbs, heads,
// turrets, horse bodies), extruded side profiles (hulls, blades, shields, boots) and faceted
// gems. They are flat shaded, so a model reads as a set of clean polygons rather than smooth
// balls and blocks. Every shape is cached by its parameters and shared like the primitives.
import * as THREE from 'three';
import { geo } from './materials.ts';

/** A cross-section: [position along the axis, size along x, size along z, x offset, z offset]. */
export type Section = [number, number, number, number?, number?];

/** Turn smooth shared normals into one normal per face: crisp facets. */
function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.computeVertexNormals();
  return out;
}

/**
 * A loft up y through cross-sections. Each ring is a superellipse with `sides` corners: `round` 2
 * is an ellipse (a polygon of `sides` sides), higher values square it off toward a box. The ends
 * are capped. Faces point flat toward ±x and ±z.
 */
export function loft(sections: Section[], sides = 8, round = 2): THREE.BufferGeometry {
  return geo(`L${sections.map((s) => s.join(',')).join(';')}|${sides}|${round}`, () => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const ring = sections.length, e = 2 / round;
    const at = (i: number): [number, number] => {
      const a = ((i + 0.5) / sides) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
    };
    sections.forEach(([y, dx, dz, ox = 0, oz = 0], r) => {
      for (let i = 0; i < sides; i++) {
        const [c, s] = at(i);
        pos.push(ox + (c * dx) / 2, y, oz + (s * dz) / 2);
        uv.push(i / sides, r / (ring - 1));
      }
    });
    for (let r = 0; r < ring - 1; r++) for (let i = 0; i < sides; i++) {
      const a = r * sides + i, b = r * sides + ((i + 1) % sides), c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
    // caps: a fan from the middle of each end ring
    for (const [r, flip] of [[0, true], [ring - 1, false]] as const) {
      const [y, , , ox = 0, oz = 0] = sections[r], mid = pos.length / 3;
      pos.push(ox, y, oz);
      uv.push(0.5, r ? 1 : 0);
      for (let i = 0; i < sides; i++) {
        const a = r * sides + i, b = r * sides + ((i + 1) % sides);
        if (flip) idx.push(mid, a, b); else idx.push(mid, b, a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return facet(g);
  });
}

/** The same loft laid along +x: sections are [x, size along y, size along z, y offset, z offset]. */
export function loftX(sections: Section[], sides = 8, round = 2): THREE.BufferGeometry {
  return geo(`LX${sections.map((s) => s.join(',')).join(';')}|${sides}|${round}`, () => {
    // build along y with x↔y swapped, then turn it so y → x (and x → -y, so flip the offset back)
    const g = loft(sections.map(([a, h, w, oy = 0, oz = 0]) => [a, h, w, -oy, oz]), sides, round).clone();
    return g.rotateZ(-Math.PI / 2);
  });
}

/**
 * A side profile (points [x, y], counter-clockwise) extruded `depth` across z and centred on it.
 * `bevel` chamfers every edge without changing the outline.
 */
export function slab(profile: [number, number][], depth: number, bevel = 0): THREE.BufferGeometry {
  return geo(`S${profile.join(';')}|${depth}|${bevel}`, () => {
    const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const b = Math.min(bevel, depth / 2.5);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: depth - b * 2, bevelEnabled: b > 0, bevelSegments: 1, bevelSize: b, bevelThickness: b, bevelOffset: -b,
    });
    return facet(g.translate(0, 0, -(depth - b * 2) / 2));
  });
}

/** A profile in the x/z plane (seen from above) extruded `h` up y from y = 0. */
export function plate(outline: [number, number][], h: number, bevel = 0): THREE.BufferGeometry {
  return geo(`P${outline.join(';')}|${h}|${bevel}`, () => {
    // extrude along z, then stand it up: z → y, and the outline's y becomes -z
    const g = slab(outline.map(([x, z]) => [x, -z]), h, bevel).clone();
    return g.rotateX(-Math.PI / 2).translate(0, h / 2, 0);
  });
}

/** A low-poly gem: a squashed icosahedron, for heads, fists, knobs and pommels. */
export function gem(r: number, sx = 1, sy = 1, sz = 1, detail = 0): THREE.BufferGeometry {
  return geo(`G${r},${sx},${sy},${sz},${detail}`, () => facet(new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz)));
}

/** A faceted surface of revolution through [radius, height] points (helmets, domes, barrels). */
export function turned(pts: [number, number][], sides = 8): THREE.BufferGeometry {
  return geo(`T${pts.join(';')}|${sides}`, () =>
    facet(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), sides, Math.PI / sides)));
}

/** A tapered limb hanging down from its pivot: `len` long, `top` thick at the pivot, `bottom` at the end. */
export function taper(len: number, top: number, bottom: number, sides = 6, depth = 1): THREE.BufferGeometry {
  return loft([[-len, bottom * depth, bottom], [-len * 0.45, top * 0.95 * depth, top * 0.95], [0, top * depth, top]], sides);
}
