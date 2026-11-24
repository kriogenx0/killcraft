import type { ArmorClass, WeaponType } from './weapon.ts';
import type { BldType } from './building.ts';

export type UnitType = 'rifleman' | 'gunner' | 'rocket' | 'swordsman' | 'crossbowman' | 'knight' | 'jeep' | 'tank' | 'heavy' | 'catapult' | 'harvester' | 'worker'
  | 'balloon' | 'biplane' | 'helicopter' | 'drone' | 'medic'
  | 'wraith' | 'hexblade' | 'phantom' | 'starfall'
  | 'mage' | 'stormcaller' | 'archmage' | 'juggernaut' | 'titan' | 'giant'
  | 'centaur' | 'minotaur' | 'harpy' | 'griffin' | 'pegasus' | 'cyclops' | 'hydra' | 'cerberus';
/** infantry turn on the spot and bleed (knights included); vehicles turn slowly and explode; aircraft fly over everything */
export type UnitClass = 'infantry' | 'vehicle' | 'air';
export type Producer = 'infantry' | 'vehicle' | 'air';

export interface UnitDef {
  name: string;
  cls: UnitClass;
  armor: ArmorClass;
  hp: number;
  /** tiles per second */
  spd: number;
  /**
   * Turn speed in radians per second. A unit turns to face where it is going before it sets off
   * (see steer in game/move.ts) and turns to face what it shoots unless it has a turret:
   * foot soldiers spin round almost at once, horses take a moment, tanks swing round slowly.
   */
  turn: number;
  weapon: WeaponType | null;
  /** ore */
  cost: number;
  wood?: number;
  oil?: number;
  /** Aether (data/aether.ts). Units that cost Aether are hidden until their side first finds some. */
  aether?: number;
  /** stays unseen by enemies until it fires or an enemy comes close (see CLOAK_* in data/aether.ts) */
  cloak?: boolean;
  /**
   * a creature of Greek myth (data/creatures.ts). Wild ones guard lairs on the map; a side can only
   * train a kind once it has captured one.
   */
  beast?: boolean;
  /** fraction of max health regained each second, whatever the side's healing research (the Hydra) */
  regen?: number;
  /**
   * a spellcaster with its own robes and staff (render3d/arcane3d.ts). Like the hidden units it costs
   * Aether, so it stays hidden until its side first finds some, but it is no copy of a regular unit.
   */
  magic?: boolean;
  /** a hulking walker of flesh and steel (render3d/arcane3d.ts): it strides on two legs and twists its torso to aim */
  cyborg?: boolean;
  /**
   * a towering giant of myth (render3d/giant3d.ts), several times the height of anything else on the
   * field. Rendered and animated on its own.
   */
  giant?: boolean;
  /** a side may have at most this many alive or in training at once */
  limit?: number;
  /** the regular unit whose model and animations this one borrows, with an Aether glow */
  look?: UnitType;
  /** build time in seconds at full power */
  t: number;
  /** the age (see data/era.ts) that unlocks this unit */
  era: number;
  /** buildings that must exist before this unit can be trained */
  requires?: BldType[];
  sight: number;
  producer: Producer;
  /** has a turret that aims independently of the hull */
  turret: boolean;
  /** body radius in px, used for spacing and clicks */
  radius: number;
  /** harvesters: ore carried per trip (anything with this gathers ore) */
  haul?: number;
  /** harvesters: ore scooped per second */
  scoop?: number;
  /** no longer trained from this age on (see data/era.ts) */
  until?: number;
  /** aircraft only: how high it flies, in tiles */
  alt?: number;
  /** preferred hotkey letter; otherwise one is picked from the name (views/game/hotkeys.ts) */
  key?: string;
  /** the hotkey sub-menu it sits in at its producer (views/game/hotkeys.ts); creatures and spellcasters get one by default */
  group?: string;
  desc: string;
}

export const UNIT: Record<UnitType, UnitDef> = {
  rifleman: { name: 'Rifleman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'rifle', cost: 100, wood: 20, t: 5, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Cheap infantry. Strong against infantry.' },
  gunner: { name: 'Machine Gunner', cls: 'infantry', armor: 'none', hp: 65, spd: 1.6, turn: 6, weapon: 'lmg', cost: 250, wood: 20, t: 8, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Belt-fed machine gun on a bipod. Mows down infantry and cavalry, but moves slowly.' },
  rocket: { name: 'Rocket Soldier', cls: 'infantry', armor: 'none', hp: 45, spd: 1.9, turn: 6.5, weapon: 'rocket', cost: 300, oil: 50, t: 8, era: 2, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Anti-armor infantry. Strong against vehicles.' },
  swordsman: { name: 'Swordsman', cls: 'infantry', armor: 'light', hp: 90, spd: 2.2, turn: 6.5, weapon: 'sword', cost: 175, t: 6, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Plate armor, sword and shield. Beats riflemen up close and shrugs off bullets.' },
  crossbowman: { name: 'Crossbowman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'crossbow', cost: 200, wood: 30, t: 7, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Armor-piercing bolts. Good against swordsmen and knights.' },
  medic: { name: 'Medic', cls: 'infantry', armor: 'none', hp: 60, spd: 2.2, turn: 6.5, weapon: null, cost: 200, t: 7, era: 0, requires: ['hospital'], sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Unarmed. Walks to wounded infantry and knights nearby and patches them up.' },
  knight: { name: 'Knight', cls: 'infantry', armor: 'light', hp: 220, spd: 4.6, turn: 5, weapon: 'lance', cost: 450, wood: 50, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, desc: 'Armored horseman. Fast charges against infantry and harvesters.' },
  jeep: { name: 'Scout Jeep', cls: 'vehicle', armor: 'light', hp: 210, spd: 5.0, turn: 4, weapon: 'mg', cost: 325, oil: 50, t: 9, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, desc: 'Fast scout with a machine gun.' },
  tank: { name: 'Battle Tank', key: 'T', cls: 'vehicle', armor: 'heavy', hp: 360, spd: 3.0, turn: 2.5, weapon: 'cannon', cost: 700, oil: 150, t: 14, era: 1, sight: 5, producer: 'vehicle', turret: true, radius: 13, desc: 'Main battle tank. Strong against vehicles and buildings.' },
  heavy: { name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.0, turn: 1.8, weapon: 'heavycannon', cost: 1300, oil: 200, t: 22, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, desc: 'Slow, heavily armored twin-cannon tank.' },
  catapult: { name: 'Catapult', cls: 'vehicle', armor: 'light', hp: 220, spd: 1.6, turn: 1.5, weapon: 'catapult', cost: 500, wood: 400, t: 16, era: 0, sight: 6, producer: 'vehicle', turret: false, radius: 14, desc: 'Lobs boulders from long range. Crushes buildings and packed infantry.' },
  harvester: { name: 'Harvester', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.4, turn: 2, weapon: null, cost: 1400, wood: 100, t: 18, era: 2, sight: 4, producer: 'vehicle', turret: false, radius: 15, haul: 600, scoop: 160, desc: 'Collects ore and brings it to a Refinery or the Town Hall. Unarmed.' },
  worker: { name: 'Worker', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'pick', cost: 250, t: 7, era: 0, sight: 4, producer: 'infantry', turret: false, radius: 6, haul: 300, scoop: 80, desc: 'Builds every structure, digs ore, chops wood and hauls oil home. When idle it repairs buildings and patches up wounded troops. Harvesters take over the ore in the Modern age.' },
  // aircraft, built at the Airfield. They fly straight over buildings, cliffs and water, and only
  // weapons that can aim upward (bows, guns, rockets, flak) can hit them.
  balloon: { name: 'War Balloon', cls: 'air', armor: 'air', hp: 170, spd: 1.3, turn: 1, weapon: 'bomb', cost: 150, wood: 200, t: 12, era: 1, sight: 9, producer: 'air', turret: false, radius: 12, alt: 2.2, desc: 'Silk envelope and a wicker basket. Drifts slowly over walls and drops bombs. Sees far.' },
  biplane: { name: 'Biplane', cls: 'air', armor: 'air', hp: 190, spd: 6.0, turn: 2.5, weapon: 'planegun', cost: 300, wood: 150, oil: 100, t: 13, era: 1, sight: 8, producer: 'air', turret: false, radius: 12, alt: 1.6, desc: 'Fast wood-and-canvas fighter. Shreds balloons, aircraft and infantry.' },
  helicopter: { name: 'Attack Helicopter', cls: 'air', armor: 'air', hp: 340, spd: 4.4, turn: 3.5, weapon: 'missile', cost: 700, oil: 300, t: 18, era: 2, sight: 7, producer: 'air', turret: false, radius: 13, alt: 1.3, desc: 'Steel gunship firing guided missiles. Deadly against tanks.' },
  drone: { name: 'Combat Drone', cls: 'air', armor: 'air', hp: 70, spd: 7.0, turn: 7, weapon: 'dronegun', cost: 200, oil: 60, t: 6, era: 2, sight: 8, producer: 'air', turret: false, radius: 8, alt: 1.1, desc: 'Cheap, fast quadcopter with a light gun. Send them in swarms; flak, rifles and machine guns knock them down.' },
  // hidden units, revealed by Aether: each matches its regular unit, plus one trick
  wraith: { name: 'Wraith Knight', cls: 'infantry', armor: 'light', hp: 240, spd: 4.6, turn: 5, weapon: 'wraithlance', cost: 400, wood: 30, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, look: 'knight', desc: 'A knight bound to Aether. Its spectral lance passes through armor.' },
  hexblade: { name: 'Hex Rifleman', cls: 'infantry', armor: 'none', hp: 57, spd: 2.0, turn: 6.5, weapon: 'hexrifle', cost: 100, wood: 20, aether: 15, t: 6, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, look: 'rifleman', desc: 'Hexed shot slows whatever it hits to half speed for a moment.' },
  phantom: { name: 'Phantom Jeep', cls: 'vehicle', armor: 'light', hp: 240, spd: 5.0, turn: 4, weapon: 'mg', cost: 350, oil: 50, aether: 40, t: 10, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, cloak: true, look: 'jeep', desc: 'Scout jeep wrapped in Aether. Unseen until it fires or an enemy comes close.' },
  starfall: { name: 'Starfall Tank', cls: 'vehicle', armor: 'heavy', hp: 410, spd: 2.8, turn: 2.5, weapon: 'starbeam', cost: 700, oil: 150, aether: 70, t: 16, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 13, look: 'tank', desc: 'Battle tank with a beam of starlight. Slow to fire, but tears through buildings.' },
  // spellcasters: they draw on Aether, so they stay hidden until their side finds some. One per age,
  // each a little stronger and stranger than the last. Robes don't stop bullets.
  mage: { name: 'Battle Mage', cls: 'infantry', armor: 'none', hp: 90, spd: 2.0, turn: 6.5, weapon: 'fireball', cost: 250, aether: 30, t: 9, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, desc: 'Hurls fireballs that burst over a crowd. Deadly to massed infantry, fragile up close.' },
  stormcaller: { name: 'Storm Caller', cls: 'infantry', armor: 'none', hp: 110, spd: 2.0, turn: 6.5, weapon: 'lightning', cost: 400, aether: 50, t: 11, era: 1, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, desc: 'Calls down lightning that leaps from its target to two more foes nearby. Strikes aircraft too.' },
  archmage: { name: 'Archmage', cls: 'infantry', armor: 'light', hp: 160, spd: 1.8, turn: 6, weapon: 'meteor', cost: 600, aether: 90, t: 16, era: 2, sight: 8, producer: 'infantry', turret: false, radius: 7, magic: true, desc: 'Pulls a burning star down on a spot far away. Slow to cast, and the meteor lands where the foe stood, but it wrecks bases.' },
  // cyborgs: Modern-age giants, half soldier, half war machine, built at the War Factory. Huge,
  // slow and costly, they wade through small-arms fire; rockets and anti-tank missiles bring them down.
  juggernaut: { name: 'Cyborg Juggernaut', key: 'J', cls: 'vehicle', armor: 'heavy', hp: 900, spd: 2.2, turn: 3, weapon: 'minigun', cost: 1200, oil: 150, t: 20, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, cyborg: true, desc: 'A towering cyborg with a rotary cannon for an arm. Mows down infantry and shrugs off bullets.' },
  titan: { name: 'Cyborg Colossus', key: 'I', cls: 'vehicle', armor: 'heavy', hp: 1500, spd: 1.6, turn: 1.8, weapon: 'railgun', cost: 2200, oil: 350, t: 32, era: 2, sight: 7, producer: 'vehicle', turret: true, radius: 19, cyborg: true, desc: 'The biggest thing on the field. Twin rail cannons punch through tanks and buildings. Can\'t hit aircraft.' },
  // the Titan: one per side, the largest thing in the game. An elder giant of bronze and stone, woken
  // with Aether. It smashes everything around it with a broken temple column; only aircraft are
  // safe from it, and massed rockets and anti-tank fire are the way to bring it down.
  giant: { name: 'Titan', cls: 'infantry', armor: 'heavy', hp: 3200, spd: 1.5, turn: 2.2, weapon: 'quake', cost: 2800, wood: 400, aether: 150, t: 50, era: 1, sight: 8, producer: 'infantry', turret: false, radius: 24, giant: true, limit: 1, group: 'Magic', desc: 'An elder giant of bronze and stone, woken with Aether. Its column smashes everything around the blow and crushes buildings. Only one at a time. Can\'t hit aircraft.' },
  // creatures of Greek myth, found wild in lairs on the map (data/creatures.ts). Capture one and the
  // side can train more of its kind for ore and Aether, in any age. Flyers come from the Airfield.
  centaur: { name: 'Centaur', cls: 'infantry', armor: 'light', hp: 220, spd: 4.2, turn: 5, weapon: 'centaurbow', cost: 350, wood: 40, aether: 35, t: 10, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 11, beast: true, desc: 'Half man, half horse. A fast archer that shoots on the gallop. Strong against infantry.' },
  minotaur: { name: 'Minotaur', cls: 'infantry', armor: 'light', hp: 460, spd: 2.4, turn: 4, weapon: 'axe', cost: 450, aether: 45, t: 12, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 12, beast: true, desc: 'Bull-headed brute with a great double axe. Slow, tough, and smashes buildings.' },
  cyclops: { name: 'Cyclops', cls: 'infantry', armor: 'heavy', hp: 400, spd: 1.8, turn: 3, weapon: 'hurl', cost: 650, aether: 70, t: 16, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 15, beast: true, desc: 'One-eyed giant who hurls boulders from long range. Crushes tanks and walls.' },
  hydra: { name: 'Hydra', cls: 'infantry', armor: 'light', hp: 450, spd: 1.6, turn: 3, weapon: 'hydrabite', cost: 600, aether: 60, t: 15, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 14, beast: true, regen: 0.012, desc: 'Many-headed serpent. Bites three foes at once and keeps growing back its wounds.' },
  cerberus: { name: 'Cerberus', cls: 'infantry', armor: 'light', hp: 380, spd: 4.0, turn: 5.5, weapon: 'hellfire', cost: 500, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 12, beast: true, desc: 'Three-headed hound of the underworld. Breathes fire over a crowd of infantry.' },
  harpy: { name: 'Harpy', cls: 'air', armor: 'air', hp: 105, spd: 6.0, turn: 5, weapon: 'talons', cost: 250, aether: 25, t: 8, era: 0, sight: 8, producer: 'air', turret: false, radius: 9, alt: 1.4, beast: true, desc: 'Shrieking winged hag. Swoops on harvesters and infantry; easy prey for archers.' },
  pegasus: { name: 'Pegasus', cls: 'air', armor: 'air', hp: 190, spd: 6.5, turn: 4, weapon: 'hoof', cost: 400, aether: 45, t: 11, era: 0, sight: 10, producer: 'air', turret: false, radius: 12, alt: 1.6, beast: true, desc: 'Winged horse. The fastest thing in the sky, it charges down on foes and sees far.' },
  griffin: { name: 'Griffin', cls: 'air', armor: 'air', hp: 230, spd: 4.8, turn: 3.5, weapon: 'griffclaw', cost: 500, aether: 55, t: 13, era: 0, sight: 8, producer: 'air', turret: false, radius: 13, alt: 1.5, beast: true, desc: 'Eagle-lion that dives on vehicles and tears aircraft out of the sky.' },
};

/** Medics heal this many hit points a second, standing within this many px of their patient. */
export const MEDIC_HEAL = 4;
export const MEDIC_RANGE = 20;
/** A Worker patches up a hurt unit this many hit points a second (half a Medic). */
export const WORKER_HEAL = 2;
/** A Worker repairs a damaged building this many hit points a second (paying ore like the Repair button). */
export const WORKER_REPAIR = 10;
/**
 * Sites only go up while Workers build them: each Worker on a site builds this much of it per second
 * of its build time (1 = one Worker builds it in its build time, two in half that).
 */
export const WORKER_BUILD = 1;

export const UNIT_TYPES = Object.keys(UNIT) as UnitType[];

export const isUnitType = (t: string): t is UnitType => t in UNIT;
