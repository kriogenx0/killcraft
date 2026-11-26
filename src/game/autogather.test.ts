// Idle Workers gather on their own, going for whatever the side needs most, and leave the
// player's own orders alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { G, hooks, type Ent } from './state.ts';
import { MW, STEP, TREE, TS } from './const.ts';
import { ais } from './ai.ts';
import { rebuildBlk } from './map.ts';
import { orderHaul, orderMove, setOrder } from './order.ts';
import { applyCommand } from './command.ts';
import { initWorld, update } from './world.ts';
import { addBuilding, addUnit, kill } from './entity.ts';
import { startSite } from './production.ts';
import { canPlace } from './building.ts';
import { BUILDING } from '../data/building.ts';
import { IDLE_GRACE, gatherSetting, jobOf, pickResource } from './autogather.ts';
import { OIL_WELLS } from '../data/map.ts';
import { dropSalvage } from './economy.ts';
import { mulberry32 } from '../util/math.ts';

function run(seconds: number): void {
  for (let i = 0; i < seconds / STEP && !G.over; i++) update(STEP);
}

const errors: unknown[] = [];
let yard: Ent;

beforeEach(() => {
  vi.spyOn(Math, 'random').mockImplementation(mulberry32(20261124));
  errors.length = 0;
  hooks.error = (e) => errors.push(e);
  G.reveal = true;
  G.demo = true;
  initWorld(1234);
  ais[0].on = false;
  ais[1].on = false;
  const y = G.ents.find((e) => e.team === 0 && e.type === 'yard');
  if (!y) throw new Error('no yard');
  yard = y;
  // a wood by the Town Hall, so wood is on offer too
  for (let ty = yard.ty - 2; ty < yard.ty + 4; ty++) for (let tx = yard.tx + 7; tx < yard.tx + 10; tx++) { G.terr[ty * MW + tx] = TREE; G.treeWood[ty * MW + tx] = 150; }
  rebuildBlk();
  for (const w of G.ents.filter((e) => e.type === 'worker')) kill(w);
});

afterEach(() => {
  vi.restoreAllMocks();
  ais[1].on = true;
  G.demo = false;
  G.reveal = false;
  expect(errors).toEqual([]);
});

const workers = (n: number): Ent[] => Array.from({ length: n }, (_, i) => addUnit('worker', 0, yard.x + (i - n / 2) * TS * 0.6, yard.y + 3 * TS));

describe('idle Workers', () => {
  it('go and gather on their own straight away, bringing it home', () => {
    const ws = workers(2);
    G.credits[0] = 1000; G.wood[0] = 1000;
    run(1);
    expect(ws.every((w) => jobOf(w))).toBe(true);
    const ore = G.credits[0], wood = G.wood[0];
    run(60);
    expect(ws.every((w) => jobOf(w))).toBe(true);
    expect(G.credits[0] + G.wood[0]).toBeGreaterThan(ore + wood + 100);
  });

  it('send more hands to the wood when wood runs low, and to the ore when ore does', () => {
    const ws = workers(4);
    G.credits[0] = 5000; G.wood[0] = 0;
    run(IDLE_GRACE + 1);
    const onWood = () => ws.filter((w) => jobOf(w) === 'wood').length;
    expect(onWood()).toBeGreaterThanOrEqual(3);
    // now short of ore with wood to spare: as they drop their loads off, they move over
    G.credits[0] = 0; G.wood[0] = 5000;
    run(60);
    expect(onWood()).toBeLessThanOrEqual(1);
    expect(ws.filter((w) => jobOf(w) === 'ore').length).toBeGreaterThanOrEqual(3);
  });

  it('on Auto, go for what the side has least of, counting what queued orders still owe', () => {
    const [w] = workers(1);
    G.credits[0] = 1100; G.wood[0] = 1000;
    expect(pickResource(w, ['ore', 'wood'])).toBe('wood');
    // a Barracks queued that the side can't pay for yet (300 ore, 100 wood): ore is now the lower
    G.prod[0].structure.push({ type: 'barracks', prog: 0, spent: 0, paid: false, ready: false, hold: false });
    expect(pickResource(w, ['ore', 'wood'])).toBe('ore');
  });

  it('with nothing short, split between ore and wood rather than all on one', () => {
    const ws = workers(6);
    G.credits[0] = 5000; G.wood[0] = 5000;
    run(IDLE_GRACE + 1);
    const ore = ws.filter((w) => jobOf(w) === 'ore').length, wood = ws.filter((w) => jobOf(w) === 'wood').length;
    expect(ore + wood).toBe(6);
    expect(ore).toBeGreaterThanOrEqual(2);
    expect(wood).toBeGreaterThanOrEqual(2);
  });

  it("keep the player's own orders, and don't switch a job the player gave", () => {
    const [mover, digger] = workers(2);
    G.credits[0] = 5000; G.wood[0] = 0;
    orderMove(mover, yard.tx - 6, yard.ty + 6);
    digger.order = { t: 'harvest', st: 'go', tx: yard.tx, ty: yard.ty + 4, wait: 0 };
    run(1);
    expect(mover.order?.t).toBe('move');
    run(40);
    expect(jobOf(digger)).toBe('ore'); // short of wood, but the player put it on the ore
    expect(digger.order?.t === 'harvest' && digger.order.auto).toBeFalsy();
  });

  it('holding a load, take it home first and then carry on gathering', () => {
    const [w] = workers(1);
    G.credits[0] = 5000; G.wood[0] = 0;
    w.carry = 50; w.cargo = 'ore'; // stopped halfway through digging
    const ore = G.credits[0];
    run(IDLE_GRACE + 30);
    expect(G.credits[0]).toBeGreaterThanOrEqual(ore + 50);
    expect(jobOf(w)).toBe('wood');
  });

  it('an Auto Worker busy on ore goes for oil once oil is what the side is short of', () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    d.carry = 300;
    const [w] = workers(1);
    G.credits[0] = 0; G.wood[0] = 5000; G.oil[0] = 5000; // ore is short: it digs ore
    run(IDLE_GRACE + 1);
    expect(jobOf(w)).toBe('ore');
    G.credits[0] = 300; G.oil[0] = 0; // now oil is (if only a little): next time it drops off, it fetches oil
    let went = false;
    for (let i = 0; i < 90 / STEP && !went; i++) { update(STEP); d.carry = 300; G.credits[0] = Math.min(G.credits[0], 300); went = jobOf(w) === 'oil'; }
    expect(went).toBe(true);
  });

  it('the Worker that builds an Oil Derrick stays on it, hauling oil', () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, true);
    d.unpaid = false;
    const [w] = workers(1);
    G.credits[0] = 5000; G.wood[0] = 5000; G.oil[0] = 5000;
    setOrder(w, { t: 'heal', tgt: d.id, ox: w.x, oy: w.y, sent: true });
    for (let i = 0; i < 120 / STEP && !d.done; i++) update(STEP);
    expect(d.done).toBe(true);
    run(60);
    expect(w.order?.t === 'harvest' && w.order.src).toBe(d.id);
    expect(gatherSetting(w)).toBe('oil');
    expect(G.oil[0]).toBeGreaterThan(5000);
  });

  it("don't crowd a slow Oil Derrick: one Worker hauls from it, and never stands there holding oil", () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    d.carry = 300;
    const ws = workers(4);
    G.credits[0] = 5000; G.wood[0] = 5000; G.oil[0] = 0;
    run(IDLE_GRACE + 1);
    expect(ws.filter((w) => jobOf(w) === 'oil')).toHaveLength(1);
    // watch the Workers: nobody holding oil stays put at the derrick
    const still = new Map<Ent, number>();
    let worst = 0;
    for (let i = 0; i < 120 / STEP; i++) {
      update(STEP);
      for (const w of ws) {
        const near = Math.hypot(w.x - d.x, w.y - d.y) < 3 * TS;
        const t = near && w.carry > 0 && w.cargo === 'oil' ? (still.get(w) ?? 0) + STEP : 0;
        still.set(w, t);
        worst = Math.max(worst, t);
      }
    }
    expect(worst).toBeLessThan(5);
    expect(G.oil[0]).toBeGreaterThan(250);
  });

  describe('switching resource, a Worker first takes home what it carries', () => {
    /** Run, failing if any Worker's load turns into another resource before it's been dropped off. */
    function watch(ws: Ent[], seconds: number): void {
      const was = new Map(ws.map((w) => [w, { cargo: w.cargo ?? 'ore', carry: w.carry }]));
      for (let i = 0; i < seconds / STEP; i++) {
        update(STEP);
        for (const w of ws) {
          const p = was.get(w);
          if (p && p.carry > 0.01 && (w.cargo ?? 'ore') !== p.cargo) throw new Error(`Worker ${w.id} started on ${w.cargo} still holding ${p.carry.toFixed(0)} ${p.cargo}`);
          was.set(w, { cargo: w.cargo ?? 'ore', carry: w.carry });
        }
      }
    }
    const tree = (): [number, number] => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < G.terr.length; i++) if (G.terr[i] === TREE && G.treeWood[i] > 0) { const d = Math.hypot((i % MW) - yard.tx, ((i / MW) | 0) - yard.ty); if (d < bd) { bd = d; best = i; } }
      return [best % MW, (best / MW) | 0];
    };

    it('sent to chop wood with ore in hand, it banks the ore first', () => {
      const [w] = workers(1);
      w.carry = 150; w.cargo = 'ore';
      const ore = G.credits[0];
      const [tx, ty] = tree();
      applyCommand(0, { c: 'harvest', ids: [w.id], tx, ty });
      watch([w], 30);
      expect(G.credits[0]).toBeGreaterThanOrEqual(ore + 150);
      expect(jobOf(w)).toBe('wood');
      expect((w.cargo as string) === 'wood' || G.wood[0] > 0).toBe(true); // chopping now
    });

    it('sent to haul oil with wood in hand, it banks the wood first', () => {
      const [wx, wy] = OIL_WELLS[0];
      const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
      d.carry = 300;
      const [w] = workers(1);
      w.carry = 40; w.cargo = 'wood';
      const wood = G.wood[0];
      orderHaul(w, d);
      watch([w], 90);
      expect(G.wood[0]).toBeGreaterThanOrEqual(wood + 40);
      expect(G.oil[0]).toBeGreaterThan(0);
    });

    it('moving between ore and wood on its own as the bank changes, it never mixes loads', () => {
      const ws = workers(4);
      G.credits[0] = 5000; G.wood[0] = 0;
      watch(ws, 40);
      G.credits[0] = 0; G.wood[0] = 5000;
      watch(ws, 40);
      expect(ws.filter((w) => jobOf(w) === 'ore').length).toBeGreaterThanOrEqual(2); // some moved over
      G.credits[0] = 5000; G.wood[0] = 0;
      watch(ws, 40);
    });
  });

  it('on Auto, move over to what the side has least of, without flitting back and forth', () => {
    const ws = workers(4);
    G.credits[0] = 2000; G.wood[0] = 8000;
    // three on wood, one on ore, though ore is far lower
    ws.forEach((w, k) => { w.order = { t: 'harvest', st: 'go', tx: w.x / TS | 0, ty: w.y / TS | 0, wait: 0, res: k ? 'wood' : undefined, auto: true }; });
    const switches = new Map<Ent, number>(), last = new Map(ws.map((w) => [w, jobOf(w)]));
    for (let k = 0; k < 45 / STEP; k++) {
      update(STEP);
      for (const w of ws) if (jobOf(w) && jobOf(w) !== last.get(w)) { switches.set(w, (switches.get(w) ?? 0) + 1); last.set(w, jobOf(w)); }
    }
    expect(ws.filter((w) => jobOf(w) === 'ore').length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...ws.map((w) => switches.get(w) ?? 0))).toBeLessThanOrEqual(1); // one move, not a dance
  });

  it('the Auto setting puts Workers back to choosing for themselves', () => {
    const ws = workers(2);
    G.credits[0] = 5000; G.wood[0] = 500;
    applyCommand(0, { c: 'gather', ids: ws.map((w) => w.id), res: 'ore' });
    expect(ws.every((w) => gatherSetting(w) === 'ore')).toBe(true);
    applyCommand(0, { c: 'gather', ids: ws.map((w) => w.id), res: 'auto' });
    expect(ws.every((w) => gatherSetting(w) === 'auto')).toBe(true);
    run(1);
    expect(ws.some((w) => jobOf(w) === 'wood')).toBe(true); // wood is what's low
  });

  it('sent by the player to one resource, stick to it', () => {
    const ws = workers(4);
    G.credits[0] = 5000; G.wood[0] = 5000;
    applyCommand(0, { c: 'gather', ids: ws.map((w) => w.id), res: 'wood' });
    run(60);
    expect(ws.every((w) => jobOf(w) === 'wood')).toBe(true);
  });

  describe('the Gather buttons', () => {
    it('Ore sends a Worker to the ore nearest the base, not the ore where it stands', () => {
      const [w] = workers(1);
      // a patch right under a Worker far out on the map
      w.x = (yard.tx + 30.5) * TS; w.y = (yard.ty + 1.5) * TS;
      for (let ty = yard.ty; ty < yard.ty + 3; ty++) for (let tx = yard.tx + 29; tx < yard.tx + 32; tx++) G.ore[ty * MW + tx] = 400;
      const far = Math.hypot(w.x - yard.x, w.y - yard.y);
      applyCommand(0, { c: 'gather', ids: [w.id], res: 'ore' });
      run(2);
      const o = w.order;
      expect(o?.t === 'harvest' && !o.res).toBe(true);
      if (o?.t !== 'harvest') return;
      expect(Math.hypot((o.tx + 0.5) * TS - yard.x, (o.ty + 0.5) * TS - yard.y)).toBeLessThan(far / 2);
    });

    it("Oil with no Oil Derrick leaves the Workers be, and says why", () => {
      const ws = workers(2);
      const said: string[] = [];
      const notify = hooks.notify;
      hooks.notify = (_t, m) => said.push(m);
      G.demo = false;
      applyCommand(0, { c: 'gather', ids: ws.map((w) => w.id), res: 'oil' });
      expect(ws.every((w) => !(w.order?.t === 'harvest' && w.order.res === 'oil'))).toBe(true);
      hooks.notify = notify;
      expect(said.some((m) => /Derrick/.test(m))).toBe(true);
    });
  });

  describe('what destroyed units leave behind', () => {
    const wreckAt = (tx: number, ty: number) => {
      const e = addUnit('tank', 1, (tx + 0.5) * TS, (ty + 0.5) * TS);
      kill(e);
      dropSalvage(e);
      return e;
    };
    const onScrap = (w: Ent) => w.order?.t === 'harvest' && !w.order.res && G.scrap[w.order.ty * MW + w.order.tx] === 1;

    it('Workers go and dig up the ore it leaves, then carry it home', () => {
      const [w] = workers(1);
      G.credits[0] = 5000; G.wood[0] = 5000;
      applyCommand(0, { c: 'gather', ids: [w.id], res: 'ore' });
      run(1);
      wreckAt(yard.tx + 1, yard.ty + 10);
      let went = false;
      for (let i = 0; i < 60 / STEP && !went; i++) { update(STEP); went = onScrap(w); }
      expect(went).toBe(true);
      const left = () => { let n = 0; for (let i = 0; i < MW * MW; i++) if (G.scrap[i]) n += G.ore[i]; return n; };
      const before = left();
      run(60);
      expect(left()).toBeLessThan(before);
    });

    it('come before anything else: an Auto Worker on wood goes for it, then back to the trees', () => {
      const [w] = workers(1);
      G.credits[0] = 5000; G.wood[0] = 0; // wood is what the side lacks
      run(1);
      expect(w.order?.t === 'harvest' && w.order.res).toBe('wood');
      wreckAt(yard.tx + 1, yard.ty + 10);
      let went = false;
      for (let i = 0; i < 120 / STEP && !went; i++) { update(STEP); went = onScrap(w); }
      expect(went).toBe(true);
      const left = () => { let n = 0; for (let i = 0; i < MW * MW; i++) if (G.scrap[i]) n += G.ore[i]; return n; };
      for (let i = 0; i < 400 / STEP && left() > 0; i++) update(STEP);
      expect(left()).toBe(0);
      run(30);
      expect(w.order?.t === 'harvest' && w.order.res).toBe('wood');
    });

    it('even out in the middle of the map, a long way from base', () => {
      const ws = workers(2);
      G.credits[0] = 5000; G.wood[0] = 0;
      run(1);
      wreckAt(MW >> 1, MW >> 1);
      expect(Math.hypot(yard.tx - (MW >> 1), yard.ty - (MW >> 1))).toBeGreaterThan(36);
      let went = false;
      for (let i = 0; i < 90 / STEP && !went; i++) { update(STEP); went = ws.some(onScrap); }
      expect(went).toBe(true);
    });

    it('but not while an enemy is standing over it', () => {
      const [w] = workers(1);
      G.credits[0] = 5000; G.wood[0] = 5000;
      applyCommand(0, { c: 'gather', ids: [w.id], res: 'ore' });
      run(1);
      wreckAt(yard.tx + 1, yard.ty + 10);
      const guard = addUnit('tank', 1, (yard.tx + 3.5) * TS, (yard.ty + 11.5) * TS);
      guard.stance = 'passive';
      let went = false;
      for (let i = 0; i < 20 / STEP && !went; i++) { update(STEP); guard.hp = guard.maxhp; went = onScrap(w); }
      expect(went).toBe(false);
    });
  });

  it("an Oil Derrick's Send Worker button sends the nearest free Worker, set to Oil", () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    const ws = workers(3);
    G.credits[0] = 5000; G.wood[0] = 5000; G.oil[0] = 5000;
    // one is putting up a building right next to the derrick: it's left to it
    const site = addBuilding('power', 0, wx + 2, wy + 2, true);
    ws[0].x = d.x + TS; ws[0].y = d.y + TS;
    applyCommand(0, { c: 'fix', ids: [ws[0].id], target: site.id });
    applyCommand(0, { c: 'recruit', id: d.id });
    const sent = ws.filter((w) => w.order?.t === 'harvest' && w.order.src === d.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toBe(ws[0]);
    expect(gatherSetting(sent[0])).toBe('oil');
  });

  it('a newly trained Worker starts on Auto and goes to what the side has least of', () => {
    G.credits[0] = 5000; G.wood[0] = 0;
    applyCommand(0, { c: 'build', type: 'worker' });
    let w: Ent | undefined;
    for (let i = 0; i < 30 / STEP && !w; i++) { update(STEP); w = G.ents.find((e) => !e.dead && e.team === 0 && e.type === 'worker'); }
    expect(w).toBeDefined();
    if (!w) return;
    expect(gatherSetting(w)).toBe('auto');
    expect(jobOf(w)).toBe('wood');
  });

  it('Oil sends every selected Worker to a Derrick, even one on a dry well (its tank still trickles)', () => {
    const [wx, wy] = OIL_WELLS[0];
    const d = addBuilding('derrick', 0, wx - 1, wy - 1, false);
    G.oilField.fill(0);
    const ws = workers(3);
    applyCommand(0, { c: 'gather', ids: ws.map((w) => w.id), res: 'oil' });
    expect(ws.every((w) => w.order?.t === 'harvest' && w.order.src === d.id)).toBe(true);
    expect(ws.every((w) => gatherSetting(w) === 'oil')).toBe(true);
  });

  it('a Worker never sets out for the field with a full load: it goes home first', () => {
    const [w] = workers(1);
    w.carry = 300; w.cargo = 'ore';
    w.order = { t: 'harvest', st: 'go', tx: yard.tx + 20, ty: yard.ty, wait: 0 };
    run(0.2);
    expect(w.order?.t === 'harvest' && w.order.st).toBe('ret');
  });

  it('dropping a load off, a Worker first fixes what is damaged nearby', () => {
    const [w] = workers(1);
    G.credits[0] = 5000; G.wood[0] = 5000;
    run(IDLE_GRACE + 1);
    expect(jobOf(w)).not.toBeNull();
    yard.hp = yard.maxhp * 0.6;
    let fixing = false;
    for (let i = 0; i < 60 / STEP && !fixing; i++) { update(STEP); fixing = w.order?.t === 'heal' && w.order.tgt === yard.id; }
    expect(fixing).toBe(true);
  });

  describe("don't wander", () => {
    /** Lay out a Power Plant site at the first free spot near the Town Hall. */
    const site = (): Ent => {
      const n = BUILDING.power.size;
      for (let r = 3; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const tx = yard.tx + dx, ty = yard.ty + dy;
        if (!canPlace(tx, ty, n, 0, true)) continue;
        const b = startSite(0, 'power', tx, ty);
        if (b) return b;
      }
      throw new Error('no site');
    };

    it('only two go and build a new site; the rest keep gathering', () => {
      const ws = workers(6);
      G.credits[0] = 5000; G.wood[0] = 5000;
      run(5);
      const b = site();
      let most = 0;
      for (let i = 0; i < 30 / STEP; i++) { update(STEP); most = Math.max(most, ws.filter((w) => w.order?.t === 'heal' && w.order.tgt === b.id).length); }
      expect(most).toBeLessThanOrEqual(2);
    });

    it('after building a site, go straight back to the job they left', () => {
      const ws = workers(3);
      G.credits[0] = 5000; G.wood[0] = 5000;
      run(5);
      const was = new Map(ws.map((w) => [w, jobOf(w)]));
      const b = site();
      const builders = ws.filter((w) => w.order?.t === 'heal');
      expect(builders.length).toBeGreaterThan(0);
      let idle = 0;
      for (let i = 0; i < 60 / STEP && !(b.done && builders.every((w) => w.order?.t === 'harvest')); i++) { update(STEP); if (builders.some((w) => !w.order)) idle += STEP; }
      expect(b.done).toBe(true);
      for (const w of builders) expect(jobOf(w)).toBe(was.get(w));
      expect(idle).toBeLessThan(0.5); // no standing about in between
    });

    it("don't run after a wounded unit that's in a fight", () => {
      const [w] = workers(1);
      G.credits[0] = 5000; G.wood[0] = 5000;
      const s = addUnit('swordsman', 0, w.x + 4 * TS, w.y);
      s.hp = s.maxhp * 0.3;
      s.foeT = G.gameT; // just hit
      run(1);
      expect(w.order?.t === 'heal' && w.order.tgt === s.id).toBe(false);
    });
  });
});

describe('a side that has lost every Worker', () => {
  it('gets one free from the Town Hall when it can’t afford one, and only that one', () => {
    G.credits[0] = 10; G.wood[0] = 0;
    applyCommand(0, { c: 'build', type: 'worker' });
    applyCommand(0, { c: 'build', type: 'worker' });
    const q = G.prod[0].infantry;
    expect(q[0]?.paid && q[0].free).toBe(true);
    expect(q.length).toBe(1); // a second one isn't free
    expect(G.credits[0]).toBe(10);
    // cancelling the free one gives nothing back
    applyCommand(0, { c: 'cancel', type: 'worker' });
    expect(q.length).toBe(0);
    expect(G.credits[0]).toBe(10);
    // with a Worker alive, it pays as usual
    workers(1);
    applyCommand(0, { c: 'build', type: 'worker' });
    expect(G.prod[0].infantry.some((it) => it.free)).toBe(false);
    expect(G.credits[0]).toBe(10);
  });
});
