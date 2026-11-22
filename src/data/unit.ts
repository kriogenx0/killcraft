import type { ArmorClass, WeaponType } from './weapon.ts';

export type UnitType = 'rifleman' | 'rocket' | 'swordsman' | 'crossbowman' | 'knight' | 'jeep' | 'tank' | 'heavy' | 'catapult' | 'harvester'
  | 'balloon' | 'biplane' | 'helicopter'
  | 'wraith' | 'hexblade' | 'phantom' | 'starfall';
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
  /** the regular unit whose model and animations this one borrows, with an Aether glow */
  look?: UnitType;
  /** build time in seconds at full power */
  t: number;
  /** the age (see data/era.ts) that unlocks this unit */
  era: number;
  sight: number;
  producer: Producer;
  /** has a turret that aims independently of the hull */
  turret: boolean;
  /** body radius in px, used for spacing and clicks */
  radius: number;
  /** aircraft only: how high it flies, in tiles */
  alt?: number;
  desc: string;
}

export const UNIT: Record<UnitType, UnitDef> = {
  rifleman: { name: 'Rifleman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, weapon: 'rifle', cost: 100, wood: 20, t: 5, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Cheap infantry. Strong against infantry.' },
  rocket: { name: 'Rocket Soldier', cls: 'infantry', armor: 'none', hp: 45, spd: 1.9, weapon: 'rocket', cost: 300, oil: 50, t: 8, era: 3, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Anti-armor infantry. Strong against vehicles.' },
  swordsman: { name: 'Swordsman', cls: 'infantry', armor: 'light', hp: 90, spd: 2.2, weapon: 'sword', cost: 150, t: 6, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Plate armor, sword and shield. Beats riflemen up close and shrugs off bullets.' },
  crossbowman: { name: 'Crossbowman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, weapon: 'crossbow', cost: 200, wood: 30, t: 7, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Armor-piercing bolts. Good against swordsmen and knights.' },
  knight: { name: 'Knight', cls: 'infantry', armor: 'light', hp: 160, spd: 4.6, weapon: 'lance', cost: 450, wood: 50, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, desc: 'Armored horseman. Fast charges against infantry and harvesters.' },
  jeep: { name: 'Scout Jeep', cls: 'vehicle', armor: 'light', hp: 170, spd: 5.0, weapon: 'mg', cost: 400, oil: 50, t: 9, era: 2, sight: 7, producer: 'vehicle', turret: true, radius: 11, desc: 'Fast scout with a machine gun.' },
  tank: { name: 'Battle Tank', cls: 'vehicle', armor: 'heavy', hp: 360, spd: 3.0, weapon: 'cannon', cost: 700, oil: 150, t: 14, era: 2, sight: 5, producer: 'vehicle', turret: true, radius: 13, desc: 'Main battle tank. Strong against vehicles and buildings.' },
  heavy: { name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.0, weapon: 'heavycannon', cost: 1300, oil: 300, t: 22, era: 3, sight: 6, producer: 'vehicle', turret: true, radius: 15, desc: 'Slow, heavily armored twin-cannon tank.' },
  catapult: { name: 'Catapult', cls: 'vehicle', armor: 'light', hp: 220, spd: 1.6, weapon: 'catapult', cost: 500, wood: 400, t: 16, era: 0, sight: 6, producer: 'vehicle', turret: false, radius: 14, desc: 'Lobs boulders from long range. Crushes buildings and packed infantry.' },
  harvester: { name: 'Harvester', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.4, weapon: null, cost: 1400, wood: 100, t: 18, era: 0, sight: 4, producer: 'vehicle', turret: false, radius: 15, desc: 'Collects ore and brings it to a refinery. Unarmed.' },
  // aircraft, built at the Airfield. They fly straight over buildings, cliffs and water, and only
  // weapons that can aim upward (bows, guns, rockets, flak) can hit them.
  balloon: { name: 'War Balloon', cls: 'air', armor: 'air', hp: 170, spd: 1.3, weapon: 'bomb', cost: 150, wood: 250, t: 12, era: 1, sight: 9, producer: 'air', turret: false, radius: 12, alt: 2.2, desc: 'Silk envelope and a wicker basket. Drifts slowly over walls and drops bombs. Sees far.' },
  biplane: { name: 'Biplane', cls: 'air', armor: 'air', hp: 190, spd: 6.0, weapon: 'planegun', cost: 300, wood: 150, oil: 150, t: 13, era: 2, sight: 8, producer: 'air', turret: false, radius: 12, alt: 1.6, desc: 'Fast wood-and-canvas fighter. Shreds balloons, aircraft and infantry.' },
  helicopter: { name: 'Attack Helicopter', cls: 'air', armor: 'air', hp: 340, spd: 4.4, weapon: 'missile', cost: 700, oil: 300, t: 18, era: 3, sight: 7, producer: 'air', turret: false, radius: 13, alt: 1.3, desc: 'Steel gunship firing guided missiles. Deadly against tanks.' },
  // hidden units, revealed by Aether: each matches its regular unit, plus one trick
  wraith: { name: 'Wraith Knight', cls: 'infantry', armor: 'light', hp: 170, spd: 4.6, weapon: 'wraithlance', cost: 400, wood: 30, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, look: 'knight', desc: 'A knight bound to Aether. Its spectral lance passes through armor.' },
  hexblade: { name: 'Hexblade Musketeer', cls: 'infantry', armor: 'none', hp: 55, spd: 2.0, weapon: 'hexrifle', cost: 110, wood: 20, aether: 25, t: 6, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, look: 'rifleman', desc: 'Hexed shot slows whatever it hits to half speed for a moment.' },
  phantom: { name: 'Phantom Jeep', cls: 'vehicle', armor: 'light', hp: 170, spd: 5.0, weapon: 'mg', cost: 450, oil: 50, aether: 60, t: 10, era: 2, sight: 7, producer: 'vehicle', turret: true, radius: 11, cloak: true, look: 'jeep', desc: 'Scout jeep wrapped in Aether. Unseen until it fires or an enemy comes close.' },
  starfall: { name: 'Starfall Tank', cls: 'vehicle', armor: 'heavy', hp: 380, spd: 2.8, weapon: 'starbeam', cost: 750, oil: 150, aether: 100, t: 16, era: 3, sight: 6, producer: 'vehicle', turret: true, radius: 13, look: 'tank', desc: 'Battle tank with a beam of starlight. Slow to fire, but tears through buildings.' },
};

export const UNIT_TYPES = Object.keys(UNIT) as UnitType[];

export const isUnitType = (t: string): t is UnitType => t in UNIT;
