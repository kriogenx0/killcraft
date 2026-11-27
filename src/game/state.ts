// Shared mutable simulation state. Nothing under src/game touches the DOM;
// views subscribe to engine events through `hooks`.
import type { FogMode, WeatherMode } from '../data/setup.ts';
import type { StormKind } from '../data/weather.ts';
import type { MapLayout } from '../data/map.ts';
import { UNIT, type UnitType } from '../data/unit.ts';
import type { ProjectileKind } from '../data/weapon.ts';
import type { SpellType } from '../data/spells.ts';
import { BUILDING, type BldType } from '../data/building.ts';
import type { TechType, UpgradeTrack } from '../data/era.ts';
import { MW, MH, TS } from './const.ts';
import { clamp } from '../util/math.ts';
import type { SideStats } from './stats.ts';

export type Tile = [number, number];
export type EntKind = 'unit' | 'bld' | 'source';
/** 'source' is an ore crystal rock, 'aether' an Aether deposit, 'shard' Aether dropped by a fallen carrier (their hp is the Aether left) */
export type EntType = UnitType | BldType | 'source' | 'aether' | 'shard';

/**
 * How a unit fights. There is only one way to move; the stance decides what happens on the way.
 * engage: stop to fight enemies it meets (the default) · skirmish: shoot on the move without
 * stopping · passive: never attack, and run away from armed enemies · tend (Workers only, their
 * default): never attack; when idle, build, repair and patch up what's nearby, then harvest.
 */
export const STANCES = ['engage', 'skirmish', 'passive', 'tend'] as const;
export type Stance = (typeof STANCES)[number];

/**
 * The stance a new unit starts on: Workers fix, then harvest; a person's troops move & attack
 * (Alex, 2026-11-24); the computer's troops engage, which its attacks and wall-breaching rely on.
 */
/**
 * What a unit does when it's attacked (Alex, 2026-11-26). pursue: go after the attacker and fight it ·
 * hold: stay put, firing back only at what's in range (gatherers carry on working) · evade: run away
 * from the attacker.
 */
export const REACTS = ['pursue', 'hold', 'evade'] as const;
export type React = (typeof REACTS)[number];

/**
 * A unit's "when attacked" setting. Unset, fighters pursue and Workers, Harvesters and Medics hold
 * (carry on with their work), for people and the computer alike; a unit left on the old "Don't
 * attack" or "Evade attacks" (passive) evades, as it always has.
 */
export function reactOf(u: Ent): React {
  if (u.react) return u.react;
  if (u.stance === 'passive') return 'evade';
  return u.kind === 'unit' && unitDef(u).weapon && u.type !== 'worker' && !unitDef(u).haul ? 'pursue' : 'hold';
}

export const defaultStance = (type: string, team: number): Stance => (type === 'worker' ? 'tend' : G.human[team] ? 'skirmish' : 'engage');

/** A move to a tile; `sub` is the enemy an engaging unit has stopped to fight on the way. */
/** `pat`: on patrol, the other end of the beat; on arriving the unit turns back toward it. */
/**
 * `pace`: marching in formation, the group's slowest speed (tiles/s), which no one with the pack goes
 * faster than; `fid` names the formation, so a straggler behind the pack can run to catch up.
 */
export interface MoveOrder { t: 'move'; gx: number; gy: number; sub: number | null; pat?: Tile; pace?: number; fid?: number; /** running away (Evade): it stops for nothing */ flee?: boolean }
/** pick: the target the player chose, while the unit fights off something that hit it on the way; it goes back to it after. */
export interface AttackOrder { t: 'attack'; tgt: number; auto: boolean; ox: number; oy: number; pick?: number }
/** What a unit is carrying home. */
export type Cargo = 'ore' | 'wood' | 'oil';
/** Gather ore from the ground, or (with `res`) haul wood or oil from the store of building `src`. */
export interface HarvestOrder { t: 'harvest'; st: 'go' | 'gather' | 'ret' | 'unload'; tx: number; ty: number; wait: number; res?: 'wood' | 'oil'; src?: number; /** a job the Worker picked itself while idle: it may switch when it drops a load off (autogather.ts) */ auto?: boolean; /** a wreck the player sent it to pick over: it keeps going back until the salvage there is gone, however far */ wreck?: Tile }
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
  /** a Worker given free to a side that had none left and couldn't pay: cancelling it refunds nothing */
  free?: boolean;
  /** finished structure waiting to be placed */
  ready: boolean;
  /** paused by the player */
  hold: boolean;
  /** the building training it right now: each producer trains one order at a time, so two Barracks train twice as fast */
  at?: number;
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
  /** Return Aether switched off: the unit keeps what it carries and takes orders as usual (on by default: it walks it home first) */
  aeKeep?: boolean;
  /** walking Aether home under Return Aether, its orders on hold */
  aeRun?: boolean;
  /** game time until which this unit shows as drawing Aether from a deposit (a beam, like an attack) */
  drawT?: number;
  /** bounty ore a unit is carrying home after destroying something of the leader's (see bounty.ts) */
  loot?: number;
  scan: number;
  rep: number;
  px: number;
  py: number;
  stkT: number;
  walk: number;
  moving: boolean;
  atkT: number;
  stance: Stance;
  /** when attacked: see REACTS and reactOf (unset: the unit's default) */
  react?: React;
  /** seconds a gun that must dig in (UnitDef.deploy) has stood still */
  setT?: number;
  /** the enemy a skirmishing unit is shooting at without stopping */
  shot: number | null;
  /** an enemy wall this unit is breaking through to reach its target (see breach.ts) */
  breach: number | null;
  /** the enemy that started attacking this unit, and when it last hit */
  foe: number | null;
  foeT: number;
  /** a jet flying on out after a pass: seconds left before it turns back (see pass in move.ts) */
  runT?: number;
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
  /** game time until which a unit is turned to stone by a Medusa's gaze: it can't move or fight */
  stoneT?: number;
  /** a Phoenix that has already risen from its ashes once this life */
  reborn?: boolean;
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
  /** the Shield spell: a bubble that soaks up hits until shieldT, or until shieldHp runs out */
  shieldT?: number;
  shieldHp?: number;
  /** when it last took a direct hit (game time), so a caster can see who's under fire */
  hitT?: number;
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
  /** a demon from the Gate of Hell (game/hell.ts) */
  demon?: Demon;
  /** a Bee called up by a Bee Queen: her id, and the game time it flies home (game/creatures.ts) */
  bee?: { q: number; until: number };
  /** a Bee Queen: game time she can next call up her swarm */
  swarmT?: number;
  /** the computer is moving it out of a storm's way until this game time (game/weather.ts) */
  dodgeT?: number;
}

/** A hailstorm or meteor shower crossing the map (game/weather.ts). Positions px, velocity px/s. */
export interface Storm {
  id: number;
  kind: StormKind;
  x: number; y: number; vx: number; vy: number;
  /** radius, px */
  r: number;
  /** seconds since it formed (it does no harm for the first STORM_FORM) */
  age: number;
  /** stones owed (meteor) or seconds to the next hail tick */
  acc: number;
}

/** The weather: the mode picked at setup, the rain, and any storms under way. */
export interface Weather {
  mode: WeatherMode;
  /** rain now, 0 (dry) to 1 (pouring), and whether it is coming on or easing off */
  rain: number;
  raining: boolean;
  /** game time the rain next starts or stops, and the next storm forms */
  rainT: number;
  stormT: number;
  storms: Storm[];
  nextId: number;
  /** the weather's own dice (game/weather.ts) */
  dice: number;
}

/** A demon's errand: lurking at its spot by the gate, or out raiding a side. */
export interface Demon {
  /** the side it's raiding, or -1 while it waits by the gate */
  raid: number;
  /** the side it has come to rescue from its last stand (it fights that side's enemies), or -1 / unset */
  aid?: number;
  /** a rescuer: game time it last had an enemy to fight */
  calmT?: number;
  /** its spot by the gate (px) */
  hx: number;
  hy: number;
  /** an enemy it gave up on (out of reach), left alone until game time `snubT` */
  snub?: number;
  snubT?: number;
  /** times in a row it couldn't walk back to its spot */
  lost?: number;
  /** game time it goes back into the gate, if it's waiting there with nothing to do (Infinity: it's waiting for a raid) */
  until?: number;
}

/** The Gate of Hell's clock and who its demons are after (game/hell.ts). */
export interface Hell {
  /** this map has the gate (staged test arenas clear it away) */
  gate: boolean;
  /** game time demons next come out to prowl while there's no leader */
  spawnT: number;
  /** demons still to climb out in the current burst, when the next one does, and how long they stay (Infinity: they're raiders) */
  burst?: number;
  burstT?: number;
  stay?: number;
  /** the gate is letting out a raid that sets out at raidT */
  stir?: boolean;
  /** raids in a row on the current leader, and when the gate's rest after RAID_LIMIT of them ends */
  raids?: number;
  restT?: number;
  /** game time each side was last sent help in a last stand */
  rescued?: number[];
  /** game time the next raid sets out (Infinity while there's no leader) */
  raidT: number;
  /** game time the next Archfiend appears (Infinity while there's no leader) */
  archT: number;
  /** the side the demons are after: the strongest army once it has trained enough troops, or -1 */
  prey: number;
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
  /** a stone of a meteor shower, falling from the sky (game/weather.ts) */
  sky?: boolean;
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
/** A campaign mission goal: 'derrick' = build an Oil Derrick, 'industrial' = research the Industrial Age at the Town Hall (Black Gold) */
export type Goal = 'derrick' | 'industrial';
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
  /** 1 on tiles where ore lies salvaged from something destroyed, until it's all dug up */
  scrap: new Uint8Array(MW * MH),
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
  /**
   * each team's side in a team game (2v2): allies share sight, never fight each other and win together.
   * Every team is its own side in one against one and free-for-all.
   */
  ally: [0, 1] as number[],
  /** teams whose slot was closed: no base and no player, never counted as knocked out */
  absent: [] as boolean[],
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
  /** the Gate of Hell (game/hell.ts) */
  hell: { gate: false, spawnT: 0, raidT: Infinity, archT: Infinity, prey: -1 } as Hell,
  /** the side with a bounty on it for being far ahead (see bounty.ts), or -1 */
  leader: -1,
  /** each team has researched the Aether Ward */
  ward: [] as boolean[],
  /** each team has researched Field Mechanics (Medics repair vehicles) */
  mech: [] as boolean[],
  /** each team's army rally point (world px; game/rally.ts), or null */
  rally: [] as (Point | null)[],
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
  /** each side knocked out so far, in order: when and why (shown on the end screen) */
  outLog: [] as { team: number; t: number; why: string }[],
  /** what each computer player decided and why (newest last, capped; saved with the game; see aiNote in ai.ts) */
  aiLog: [] as { team: number; t: number; why: string }[],
  /** each side's record of the match, for the end screen (see stats.ts) */
  stats: [] as SideStats[],
  /** both sides are computer-controlled */
  demo: false,
  /** reveal the whole map (fog of war Off, watching, or testing) */
  reveal: false,
  /** fog of war: 'reveal' keeps explored ground fully visible; 'regrow' fogs it over again (troops hidden) once nobody on the side sees it */
  fog: 'reveal' as FogMode,
  /** rain and storms (game/weather.ts) */
  weather: { mode: 'off', rain: 0, raining: false, rainT: Infinity, stormT: Infinity, storms: [], nextId: 1, dice: 1 } as Weather,
  /** the latest age any side may research (0 Medieval, 1 Industrial, 2 Modern); campaign missions cap it */
  maxEra: 2,
  /** the campaign mission being played (see data/campaign.ts), or null outside the campaign */
  mission: null as string | null,
  /** a winter map: snow on the ground and trees, and snow falling (looks only) */
  snow: false,
  /** a small map: only a square this many tiles across in the middle of the grid is land (0: the full map; data/map.ts smallLayout) */
  small: 0 as number | boolean,
  /** a campaign mission's own layout (bases, ore, oil, woods), instead of the standard one for the player count */
  layout: null as MapLayout | null,
  /** each side on its own island, with sea between (campaign mission 5): only aircraft cross */
  islands: false,
  /** the computers against the player make a few small raids early on (campaign missions 3 and 5, see ai.ts military) */
  raids: false,
  /** a mission's scattered enemy camps come to each other's help: tiles a camp unit hears a fight from (0: they hold their ground; ai.ts campAlarm) */
  camps: 0,
  /** a campaign mission's extra goals for the player (side 0), beside destroying the enemy, and those met so far */
  goals: [] as Goal[],
  goalsDone: [] as Goal[],
  /** creature lairs and the Gate of Hell are on the map (false in campaign missions; eggs then hatch no creatures) */
  wild: true,
  /** units, buildings and research nobody may use in this game (a campaign mission's rules) */
  banned: [] as string[],
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
  /** a meteor shower's stone starts falling toward a spot (the server forwards these so clients can draw it) */
  skyfall: (_x: number, _y: number): void => {},
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

/** Same team, or on the same side in a team game. Wild creatures and neutrals (team -1) are only allied with each other. */
export const allied = (a: number, b: number): boolean => a === b || (a >= 0 && b >= 0 && (G.ally[a] ?? a) === (G.ally[b] ?? b));
/**
 * Something any side may fight: a side's own units and buildings, a wild creature (or its Bees), or a demon.
 * Neutral things (ore, Aether, cows) aren't.
 */
export const fair = (e: Ent): boolean => e.team >= 0 || !!e.wild || !!e.demon || !!e.bee;
/** Is this demon out to fight `team`: raiding it, or come to rescue one of its enemies? Other demons leave the side be. */
export const demonAfter = (e: Ent, team: number): boolean => {
  const d = e.demon;
  if (!d) return false;
  if ((d.aid ?? -1) >= 0) return team >= 0 && !allied(d.aid as number, team);
  return d.raid >= 0 && allied(d.raid, team);
};
/** Something a side may order its troops to attack: an enemy side's unit or building, a wild creature or a demon. */
export const targetable = (team: number, e: Ent): boolean => !e.dead && e.kind !== 'source' && fair(e) && !allied(team, e.team);
/** Two real sides at war: different teams that aren't allies. */
export const hostile = (a: number, b: number): boolean => a >= 0 && b >= 0 && !allied(a, b);

/** Some side has more than one team on it (2v2). */
export const teamGame = (): boolean => G.ally.some((a, t) => !G.absent?.[t] && G.ally.some((b, u) => u !== t && b === a && !G.absent?.[u]));

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
/** Most ore a unit carries per trip (Workers carry less ore than wood or oil). */
export const oreLoadOf = (e: Ent): number => unitDef(e).oreLoad ?? haulOf(e);
/** Most a unit carries of what it's carrying now (ore, or oil and wood). */
export const loadOf = (e: Ent): number => ((e.cargo ?? 'ore') === 'ore' ? oreLoadOf(e) : haulOf(e));
export const isOrganic = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'infantry';
export const isVehicle = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'vehicle';
/** Aircraft fly straight over everything and only some weapons can reach them. */
export const isAir = (e: Ent): boolean => e.kind === 'unit' && unitDef(e).cls === 'air';
/** Jets can't hover: they make passes at targets and circle when idle (see game/move.ts). */
export const isJet = (e: Ent): boolean => e.kind === 'unit' && !!unitDef(e).jet;
/** How high an entity flies, in px (0 on the ground). */
export const altOf = (e: Ent): number => (e.kind === 'unit' ? (unitDef(e).alt ?? 0) * TS : 0);
