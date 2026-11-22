// Shared mutable simulation state. Nothing under src/game touches the DOM;
// views subscribe to engine events through `hooks`.
import { UNIT, type UnitType } from '../data/unit.ts';
import type { ProjectileKind } from '../data/weapon.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import type { TechType } from '../data/era.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';

export type Tile = [number, number];
export type EntKind = 'unit' | 'bld' | 'source';
/** 'source' is an ore crystal rock, 'aether' an Aether deposit (its hp is the Aether left) */
export type EntType = UnitType | BldType | 'source' | 'aether';

export interface MoveOrder { t: 'move' }
export interface AMoveOrder { t: 'amove'; gx: number; gy: number; sub: number | null }
export interface AttackOrder { t: 'attack'; tgt: number; auto: boolean; ox: number; oy: number }
export interface HarvestOrder { t: 'harvest'; st: 'go' | 'gather' | 'ret' | 'unload'; tx: number; ty: number; wait: number }
export type Order = MoveOrder | AMoveOrder | AttackOrder | HarvestOrder;

export type ProductionLine = 'structure' | 'infantry' | 'vehicle' | 'tech';
export interface ProductionItem {
  type: UnitType | BldType | TechType;
  /** 0..1 */
  prog: number;
  /** ore paid so far (wood and oil are paid at the same pace, so they're prog × price) */
  spent: number;
  /** finished structure waiting to be placed */
  ready: boolean;
  /** paused by the player */
  hold: boolean;
}
export type Production = Record<ProductionLine, ProductionItem[]>;

export interface Point { x: number; y: number }

/** Anything with a position and an optional footprint (units have w = h = 0). */
export interface Target extends Point { tx: number; ty: number; w: number; h: number }

export interface Ent extends Target {
  id: number;
  kind: EntKind;
  type: EntType;
  team: number;
  hp: number;
  maxhp: number;
  dead: boolean;
  flash: number;
  // units
  order: Order | null;
  path: Tile[] | null;
  goal: Tile | null;
  cd: number;
  /** hull facing */
  face: number;
  /** turret / weapon facing */
  tface: number;
  /** ore carried (harvesters) */
  carry: number;
  scan: number;
  rep: number;
  px: number;
  py: number;
  stkT: number;
  walk: number;
  moving: boolean;
  atkT: number;
  // buildings
  done: boolean;
  /** 0..1 rise-up animation after placement */
  prog: number;
  repairing: boolean;
  /** where newly built units go */
  rally: Point | null;
  /** game time until which a hexed unit moves at reduced speed */
  slowT?: number;
  /** game time until which a cloaked unit shows after firing */
  shownT?: number;
}

export interface Projectile {
  kind: Exclude<ProjectileKind, 'melee' | 'bullet'>;
  x: number; y: number; z: number; z0: number;
  tid: number; dmg: number; src: number; team: number;
  weapon: string; sp: number; d0: number; tr: number; a: number; dead: boolean;
}

export type FxKind = 'blood' | 'chip' | 'debris' | 'spark' | 'dust' | 'smoke' | 'fire' | 'flash' | 'tracer' | 'trail' | 'ore';
export interface Particle {
  kind: FxKind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size: number; col: string | null; rot: number; soft: boolean; landed: boolean;
  /** end point for tracers */
  ex: number; ey: number;
}

export interface Decal {
  kind: 'splat' | 'corpse' | 'rubble' | 'wreck' | 'scorch';
  x: number; y: number; t: number; max: number; team: number; seed: number; w: number; r: number; a: number;
}

export const G = {
  terr: new Uint8Array(MW * MH),
  /** ore on each tile */
  ore: new Int16Array(MW * MH),
  blk: new Uint8Array(MW * MH),
  /** fog per team: 0 unexplored, 1 explored, 2 visible */
  sight: [new Uint8Array(MW * MH), new Uint8Array(MW * MH)],
  /** fog of the team being viewed on this screen (an alias of sight[viewer]) */
  vis: new Uint8Array(MW * MH),
  /** the team this screen shows (the local player) */
  viewer: 0,
  /** which teams are people (they only build on ground they've explored) */
  human: [true, false],
  /** running on the server: no visual effects */
  headless: false,
  /** online client: draw what the server reports, never decide damage */
  visualOnly: false,
  ents: [] as Ent[],
  byId: new Map<number, Ent>(),
  projs: [] as Projectile[],
  fx: [] as Particle[],
  decals: [] as Decal[],
  /** ore */
  credits: [] as number[],
  wood: [] as number[],
  oil: [] as number[],
  /** Aether, the rare resource (see data/aether.ts) */
  aether: [] as number[],
  /** each team has drawn Aether at least once, revealing its hidden units */
  aetherFound: [] as boolean[],
  /** each team has researched the Aether Ward */
  ward: [] as boolean[],
  /** each team's age of technology (index into ERA) */
  era: [] as number[],
  /** each team's healing level (index into HEAL_RATE) */
  heal: [] as number[],
  prod: [] as Production[],
  nextId: 1,
  seed: 0,
  gameT: 0,
  over: false,
  winner: -1,
  /** both sides are computer-controlled */
  demo: false,
  /** reveal the whole map (testing) */
  reveal: false,
  alertT: [-99, -99],
  /** last place the viewer's team was attacked */
  lastAlert: null as Point | null,
  fogT: 0,
  aiT: 0,
  endT: 0,
  oreT: 0,
};

export const hooks = {
  oreChanged: (): void => {},
  fogUpdated: (): void => {},
  /** a message for one team's player */
  notify: (_team: number, _msg: string): void => {},
  /** one team is under attack at a spot */
  alert: (_team: number, _x: number, _y: number): void => {},
  /** a weapon fired (the server forwards these so clients can draw shots) */
  fired: (_shooter: Ent, _weapon: string, _target: Ent): void => {},
  /** an entity was destroyed */
  killed: (_e: Ent): void => {},
  error: (err: unknown): void => { console.error(err); },
};

export function valid(id: number | null | undefined): Ent | null {
  if (id == null) return null;
  const e = G.byId.get(id);
  return e && !e.dead ? e : null;
}

export const tileOf = (v: number): number => clamp(Math.floor(v / TS), 0, MW - 1);

export function blkAt(x: number, y: number): boolean {
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return true;
  return G.blk[ty * MW + tx] === 1;
}

/** Show a message to one team's player. */
export function say(team: number, msg: string): void {
  if (!G.demo) hooks.notify(team, msg);
}

export const unitDef = (e: Ent) => UNIT[e.type as UnitType];
export const bldDef = (e: Ent) => BUILDING[e.type as BldType];
/** Living units (infantry and knights) bleed and heal; vehicles don't. */
export const isOrganic = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'infantry';
export const isVehicle = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'vehicle';
