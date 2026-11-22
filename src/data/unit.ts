import type { ArmorClass, WeaponType } from './weapon.ts';
import type { BldType } from './building.ts';

export type UnitType = 'rifleman' | 'gunner' | 'rocket' | 'swordsman' | 'crossbowman' | 'knight' | 'jeep' | 'tank' | 'heavy' | 'catapult' | 'harvester' | 'worker'
  | 'balloon' | 'biplane' | 'helicopter' | 'drone' | 'medic'
  | 'wraith' | 'hexblade' | 'phantom' | 'starfall'
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
  desc: string;
}

export const UNIT: Record<UnitType, UnitDef> = {
  rifleman: { name: 'Rifleman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, weapon: 'rifle', cost: 100, wood: 20, t: 5, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Cheap infantry. Strong against infantry.' },
  gunner: { name: 'Machine Gunner', cls: 'infantry', armor: 'none', hp: 65, spd: 1.6, weapon: 'lmg', cost: 250, wood: 20, t: 8, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Belt-fed machine gun on a bipod. Mows down infantry and cavalry, but moves slowly.' },
  rocket: { name: 'Rocket Soldier', cls: 'infantry', armor: 'none', hp: 45, spd: 1.9, weapon: 'rocket', cost: 300, oil: 50, t: 8, era: 2, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Anti-armor infantry. Strong against vehicles.' },
  swordsman: { name: 'Swordsman', cls: 'infantry', armor: 'light', hp: 90, spd: 2.2, weapon: 'sword', cost: 150, t: 6, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Plate armor, sword and shield. Beats riflemen up close and shrugs off bullets.' },
  crossbowman: { name: 'Crossbowman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, weapon: 'crossbow', cost: 200, wood: 30, t: 7, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Armor-piercing bolts. Good against swordsmen and knights.' },
  medic: { name: 'Medic', cls: 'infantry', armor: 'none', hp: 60, spd: 2.2, weapon: null, cost: 200, t: 7, era: 0, requires: ['hospital'], sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Unarmed. Walks to wounded infantry and knights nearby and patches them up.' },
  knight: { name: 'Knight', cls: 'infantry', armor: 'light', hp: 160, spd: 4.6, weapon: 'lance', cost: 450, wood: 50, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, desc: 'Armored horseman. Fast charges against infantry and harvesters.' },
  jeep: { name: 'Scout Jeep', cls: 'vehicle', armor: 'light', hp: 170, spd: 5.0, weapon: 'mg', cost: 400, oil: 50, t: 9, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, desc: 'Fast scout with a machine gun.' },
  tank: { name: 'Battle Tank', key: 'T', cls: 'vehicle', armor: 'heavy', hp: 360, spd: 3.0, weapon: 'cannon', cost: 700, oil: 150, t: 14, era: 1, sight: 5, producer: 'vehicle', turret: true, radius: 13, desc: 'Main battle tank. Strong against vehicles and buildings.' },
  heavy: { name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.0, weapon: 'heavycannon', cost: 1300, oil: 300, t: 22, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, desc: 'Slow, heavily armored twin-cannon tank.' },
  catapult: { name: 'Catapult', cls: 'vehicle', armor: 'light', hp: 220, spd: 1.6, weapon: 'catapult', cost: 500, wood: 400, t: 16, era: 0, sight: 6, producer: 'vehicle', turret: false, radius: 14, desc: 'Lobs boulders from long range. Crushes buildings and packed infantry.' },
  harvester: { name: 'Harvester', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.4, weapon: null, cost: 1400, wood: 100, t: 18, era: 2, sight: 4, producer: 'vehicle', turret: false, radius: 15, haul: 600, scoop: 160, desc: 'Collects ore and brings it to a refinery. Unarmed.' },
  worker: { name: 'Worker', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, weapon: null, cost: 250, t: 7, era: 0, until: 2, sight: 4, producer: 'infantry', turret: false, radius: 6, haul: 300, scoop: 80, desc: 'Peasant with a pick and a basket. Digs ore and carries it to a refinery. Unarmed; heals like other infantry. Replaced by the Harvester in the Modern age.' },
  // aircraft, built at the Airfield. They fly straight over buildings, cliffs and water, and only
  // weapons that can aim upward (bows, guns, rockets, flak) can hit them.
  balloon: { name: 'War Balloon', cls: 'air', armor: 'air', hp: 170, spd: 1.3, weapon: 'bomb', cost: 150, wood: 250, t: 12, era: 1, sight: 9, producer: 'air', turret: false, radius: 12, alt: 2.2, desc: 'Silk envelope and a wicker basket. Drifts slowly over walls and drops bombs. Sees far.' },
  biplane: { name: 'Biplane', cls: 'air', armor: 'air', hp: 190, spd: 6.0, weapon: 'planegun', cost: 300, wood: 150, oil: 150, t: 13, era: 1, sight: 8, producer: 'air', turret: false, radius: 12, alt: 1.6, desc: 'Fast wood-and-canvas fighter. Shreds balloons, aircraft and infantry.' },
  helicopter: { name: 'Attack Helicopter', cls: 'air', armor: 'air', hp: 340, spd: 4.4, weapon: 'missile', cost: 700, oil: 300, t: 18, era: 2, sight: 7, producer: 'air', turret: false, radius: 13, alt: 1.3, desc: 'Steel gunship firing guided missiles. Deadly against tanks.' },
  drone: { name: 'Combat Drone', cls: 'air', armor: 'air', hp: 90, spd: 7.0, weapon: 'dronegun', cost: 200, oil: 60, t: 6, era: 2, sight: 8, producer: 'air', turret: false, radius: 8, alt: 1.1, desc: 'Cheap, fast quadcopter with a light gun. Send them in swarms; flak, rifles and machine guns knock them down.' },
  // hidden units, revealed by Aether: each matches its regular unit, plus one trick
  wraith: { name: 'Wraith Knight', cls: 'infantry', armor: 'light', hp: 170, spd: 4.6, weapon: 'wraithlance', cost: 400, wood: 30, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, look: 'knight', desc: 'A knight bound to Aether. Its spectral lance passes through armor.' },
  hexblade: { name: 'Hex Rifleman', cls: 'infantry', armor: 'none', hp: 55, spd: 2.0, weapon: 'hexrifle', cost: 110, wood: 20, aether: 25, t: 6, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, look: 'rifleman', desc: 'Hexed shot slows whatever it hits to half speed for a moment.' },
  phantom: { name: 'Phantom Jeep', cls: 'vehicle', armor: 'light', hp: 170, spd: 5.0, weapon: 'mg', cost: 450, oil: 50, aether: 60, t: 10, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, cloak: true, look: 'jeep', desc: 'Scout jeep wrapped in Aether. Unseen until it fires or an enemy comes close.' },
  starfall: { name: 'Starfall Tank', cls: 'vehicle', armor: 'heavy', hp: 380, spd: 2.8, weapon: 'starbeam', cost: 750, oil: 150, aether: 100, t: 16, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 13, look: 'tank', desc: 'Battle tank with a beam of starlight. Slow to fire, but tears through buildings.' },
  // creatures of Greek myth, found wild in lairs on the map (data/creatures.ts). Capture one and the
  // side can train more of its kind for ore and Aether, in any age. Flyers come from the Airfield.
  centaur: { name: 'Centaur', cls: 'infantry', armor: 'light', hp: 220, spd: 4.2, weapon: 'centaurbow', cost: 350, wood: 40, aether: 35, t: 10, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 11, beast: true, desc: 'Half man, half horse. A fast archer that shoots on the gallop. Strong against infantry.' },
  minotaur: { name: 'Minotaur', cls: 'infantry', armor: 'light', hp: 460, spd: 2.4, weapon: 'axe', cost: 450, aether: 45, t: 12, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 12, beast: true, desc: 'Bull-headed brute with a great double axe. Slow, tough, and smashes buildings.' },
  cyclops: { name: 'Cyclops', cls: 'infantry', armor: 'heavy', hp: 650, spd: 1.8, weapon: 'hurl', cost: 650, aether: 70, t: 16, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 15, beast: true, desc: 'One-eyed giant who hurls boulders from long range. Crushes tanks and walls.' },
  hydra: { name: 'Hydra', cls: 'infantry', armor: 'light', hp: 560, spd: 1.6, weapon: 'hydrabite', cost: 600, aether: 60, t: 15, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 14, beast: true, regen: 0.012, desc: 'Many-headed serpent. Bites three foes at once and keeps growing back its wounds.' },
  cerberus: { name: 'Cerberus', cls: 'infantry', armor: 'light', hp: 380, spd: 4.0, weapon: 'hellfire', cost: 500, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 12, beast: true, desc: 'Three-headed hound of the underworld. Breathes fire over a crowd of infantry.' },
  harpy: { name: 'Harpy', cls: 'air', armor: 'air', hp: 130, spd: 6.0, weapon: 'talons', cost: 250, aether: 25, t: 8, era: 0, sight: 8, producer: 'air', turret: false, radius: 9, alt: 1.4, beast: true, desc: 'Shrieking winged hag. Swoops on harvesters and infantry; easy prey for archers.' },
  pegasus: { name: 'Pegasus', cls: 'air', armor: 'air', hp: 240, spd: 6.5, weapon: 'hoof', cost: 400, aether: 45, t: 11, era: 0, sight: 10, producer: 'air', turret: false, radius: 12, alt: 1.6, beast: true, desc: 'Winged horse. The fastest thing in the sky, it charges down on foes and sees far.' },
  griffin: { name: 'Griffin', cls: 'air', armor: 'air', hp: 340, spd: 4.8, weapon: 'griffclaw', cost: 500, aether: 55, t: 13, era: 0, sight: 8, producer: 'air', turret: false, radius: 13, alt: 1.5, beast: true, desc: 'Eagle-lion that dives on vehicles and tears aircraft out of the sky.' },
};

/** Medics heal this many hit points a second, standing within this many px of their patient. */
export const MEDIC_HEAL = 6;
export const MEDIC_RANGE = 20;

export const UNIT_TYPES = Object.keys(UNIT) as UnitType[];

export const isUnitType = (t: string): t is UnitType => t in UNIT;
