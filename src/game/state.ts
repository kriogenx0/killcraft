// Shared mutable simulation state. Nothing under src/game touches the DOM;
// views subscribe to engine events through `hooks`.
import { UNIT, type UnitType } from '../data/unit.ts';
import type { ProjectileKind } from '../data/weapon.ts';
import type { SpellType } from '../data/spells.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import type { TechType, UpgradeTrack } from '../data/era.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';

export type Tile = [number, number];
export type EntKind = 'unit' | 'bld' | 'source';
/** 'source' is an ore crystal rock, 'aether' an Aether deposit, 'shard' Aether dropped by a fallen carrier (their hp is the Aether left) */
export type EntType = UnitType | BldType | 'source' | 'aether' | 'shard';

/**
 * How a unit fights. There is only one way to move; the stance decides what happens on the way.
 * engage: stop to fight enemies it meets (the default) · skirmish: shoot on the move without
 * stopping · passive: never attack, and run away from armed enemies.
 */
export const STANCES = ['engage', 'skirmish', 'passive'] as const;
export type Stance = (typeof STANCES)[number];

/** A move to a tile; `sub` is the enemy an engaging unit has stopped to fight on the way. */
/** `pat`: on patrol, the other end of the beat; on arriving the unit turns back toward it. */
export interface MoveOrder { t: 'move'; gx: number; gy: number; sub: number | null; pat?: Tile }
export interface AttackOrder { t: 'attack'; tgt: number; auto: boolean; ox: number; oy: number }
/** What a unit is carrying home. */
export type Cargo = 'ore' | 'wood' | 'oil';
/** Gather ore from the ground, or (with `res`) haul wood or oil from the store of building `src`. */
export interface HarvestOrder { t: 'harvest'; st: 'go' | 'gather' | 'ret' | 'unload'; tx: number; ty: number; wait: number; res?: 'wood' | 'oil'; src?: number }
/**
 * A medic tending a wounded ally, or a Worker mending an ally or building (repairing it, or helping a
 * site go up). One it found itself gives up if it strays too far from where it started (ox, oy).
 */
export interface HealOrder { t: 'heal'; tgt: number; ox: number; oy: number; /** given by a player or the computer: no leash */ sent?: boolean }
export type Order = MoveOrder | AttackOrder | HarvestOrder | HealOrder;

export type ProductionLine = 'structure' | 'infantry' | 'vehicle' | 'air' | 'tech' | 'hospital' | 'armory';
export interface ProductionItem {
  type: UnitType | BldType | TechType;
  /** 0..1 */
  prog: number;
  /** ore paid for it (the whole price is paid when the order starts) */
  spent: number;
  /** paid for and started; an order the side can't afford yet waits in the queue until it can */
  paid: boolean;
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
  /** load carried by harvesters and Workers (see `cargo`), or what a mill or derrick holds in store */
  carry: number;
  /** what `carry` is; ore if unset */
  cargo?: Cargo;
  /** Aether carried home from a deposit */
  ae?: number;
  /** game time until which this unit shows as drawing Aether from a deposit (a beam, like an attack) */
  drawT?: number;
  /** bounty ore a unit is carrying home after destroying something of the leader's (see bounty.ts) */
  loot?: number;
  /** a Worker told to fix everything nearby, then harvest: looks further for things to mend until there are none */
  tending?: boolean;
  scan: number;
  rep: number;
  px: number;
  py: number;
  stkT: number;
  walk: number;
  moving: boolean;
  atkT: number;
  stance: Stance;
  /** the enemy a skirmishing unit is shooting at without stopping */
  shot: number | null;
  /** an enemy wall this unit is breaking through to reach its target (see breach.ts) */
  breach: number | null;
  /** the enemy that started attacking this unit, and when it last hit */
  foe: number | null;
  foeT: number;
  // buildings
  done: boolean;
  /** 0..1 rise-up animation after placement */
  prog: number;
  repairing: boolean;
  /** a site placed before the side could pay for it: Workers can't build it until it's paid (production.ts) */
  unpaid?: boolean;
  /** the age a building's look and stats belong to: the one it was built in, plus upgrades (see refit.ts) */
  lvl?: number;
  /** 0..1 progress of an upgrade under way */
  upT?: number;
  /** where newly built units go */
  rally: Point | null;
  /** game time until which a hexed unit moves at reduced speed */
  slowT?: number;
  /** a spellcaster's mana (data/spells.ts) */
  mana?: number;
  /** game time each of a caster's spells is ready again */
  spellCd?: Partial<Record<SpellType, number>>;
  /** lasting effects of spells and elements (game/spells.ts): game time each wears off */
  burnT?: number;
  poisonT?: number;
  wetT?: number;
  sludgeT?: number;
  frozenT?: number;
  lustT?: number;
  /** the Slow spell: reloads take longer too (slowT covers the walking) */
  curseT?: number;
  /** who set it burning or poisoned it, for the kill */
  burnBy?: number;
  poisonBy?: number;
  /** seconds toward the next tick of burning or poison */
  dotT?: number;
  /** game time until which a cloaked unit shows after firing */
  shownT?: number;
  /** a wild creature guarding its lair (data/creatures.ts); dropped once a side captures it */
  wild?: Wild;
  /** a captured creature's lair (px), where it comes back wild after it dies */
  lair?: Point;
}

/** A wild creature's lair, and whether it's kneeling and being captured. */
export interface Wild {
  /** lair, px */
  lx: number;
  ly: number;
  /** beaten down and kneeling */
  down: boolean;
  /** game time it knelt */
  downT: number;
  /** the side capturing it (-1 for none) and seconds held so far */
  by: number;
  held: number;
}

/** Shots in flight, and sword and lance blows on their way down ('melee': lands after MELEE_LAND seconds). */
export interface Projectile {
  kind: Exclude<ProjectileKind, 'bullet'>;
  x: number; y: number; z: number; z0: number;
  tid: number; dmg: number; src: number; team: number;
  weapon: string; sp: number; d0: number; tr: number; a: number; dead: boolean;
  /** where a lobbed (non-homing) shell will land */
  gx?: number; gy?: number;
}

export type FxKind = 'blood' | 'chip' | 'debris' | 'spark' | 'dust' | 'smoke' | 'fire' | 'flash' | 'tracer' | 'trail' | 'ore' | 'slash';
export interface Particle {
  kind: FxKind; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; size: number; col: string | null; rot: number; soft: boolean; landed: boolean;
  /** end point for tracers */
  ex: number; ey: number;
  /** end height for tracers (px) */
  ez: number;
}

/** Two linked gates: a unit stepping onto one comes out of the other. Tile coordinates. */
export interface Portal { a: Tile; b: Tile }
/** A linked pair of Waygates: like a portal, but only its team may use it. */
export interface Waygate extends Portal { team: number }

export interface Decal {
  kind: 'splat' | 'corpse' | 'rubble' | 'wreck' | 'scorch';
  x: number; y: number; t: number; max: number; team: number; seed: number; w: number; r: number; a: number;
}

export const G = {
  terr: new Uint8Array(MW * MH),
  /** ground height at each tile's centre, in tiles (water sits at WATER_LEVEL) */
  elev: new Float32Array(MW * MH),
  /** ore on each tile */
  ore: new Int16Array(MW * MH),
  /** oil left in the ground on each tile (never refills) */
  oilField: new Float32Array(MW * MH),
  /** wood left on each tree tile (grows back) */
  treeWood: new Float32Array(MW * MH),
  blk: new Uint8Array(MW * MH),
  /** linked portal pairs on this map */
  portals: [] as Portal[],
  /** for each tile, the tile index its portal leads to, or -1 */
  warp: new Int32Array(MW * MH).fill(-1),
  /** linked Waygate pairs (see game/aether.ts) */
  waygates: [] as Waygate[],
  /** for each warp tile, the only team that may use it, or -1 for anyone (map portals) */
  warpTeam: new Int8Array(MW * MH).fill(-1),
  /** fog per team: 0 unexplored, 1 explored, 2 visible */
  sight: [new Uint8Array(MW * MH), new Uint8Array(MW * MH)],
  /** fog of the team being viewed on this screen (an alias of sight[viewer]) */
  vis: new Uint8Array(MW * MH),
  /** the team this screen shows (the local player) */
  viewer: 0,
  /** number of sides in the match (2, or 4 for a free-for-all) */
  teams: 2,
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
  /** creature kinds each team has captured, and so can train (data/creatures.ts) */
  tamed: [] as string[][],
  /** creatures that died and come back wild at their lair at game time `t` */
  respawns: [] as { type: string; x: number; y: number; t: number }[],
  /** the side with a bounty on it for being far ahead (see bounty.ts), or -1 */
  leader: -1,
  /** each team has researched the Aether Ward */
  ward: [] as boolean[],
  /** each team's age of technology (index into ERA) */
  era: [] as number[],
  /** each team's healing level (index into HEAL_RATE) */
  heal: [] as number[],
  /** each team's Armory upgrade levels */
  upg: [] as Record<UpgradeTrack, number>[],
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
  /** damage from `by` (if known) destroyed an entity; called just before `killed` */
  killedBy: (_e: Ent, _by: Ent | null): void => {},
  /** a harvester unloaded `amount` ore */
  income: (_team: number, _amount: number): void => {},
  /** a side banked resources at a spot on the map (`by` merges a steady trickle, such as unloading, into one number) */
  gain: (_team: number, _x: number, _y: number, _kind: 'ore' | 'wood' | 'oil' | 'aether', _amount: number, _by: number): void => {},
  /** a side was paid a bounty for destroying something of the leader's */
  bounty: (_team: number, _amount: number): void => {},
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
/** Anything that gathers ore: Workers until the Modern age, Harvesters after. */
export const isHarvester = (e: Ent): boolean => e.kind === 'unit' && !!unitDef(e).haul;
/** Ore it carries per trip. */
export const haulOf = (e: Ent): number => unitDef(e).haul ?? 0;
export const isOrganic = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'infantry';
export const isVehicle = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'vehicle';
/** Aircraft fly straight over everything and only some weapons can reach them. */
export const isAir = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'air';
/** How high an entity flies, in px (0 on the ground). */
export const altOf = (e: Ent): number => (e.kind === 'unit' ? (unitDef(e).alt ?? 0) * TS : 0);
