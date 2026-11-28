import type { ArmorClass, WeaponType } from './weapon.ts';
import type { BldType } from './building.ts';
import type { SpellType } from './spells.ts';

export type UnitType = 'rifleman' | 'gunner' | 'rocket' | 'swordsman' | 'crossbowman' | 'knight' | 'jeep' | 'tank' | 'heavy' | 'catapult' | 'artillery' | 'harvester' | 'worker' | 'guardian' | 'flamer'
  | 'balloon' | 'biplane' | 'helicopter' | 'drone' | 'fighter' | 'striker' | 'carrier' | 'hornet' | 'medic'
  | 'wraith' | 'hexblade' | 'phantom' | 'starfall'
  | 'mage' | 'stormcaller' | 'archmage' | 'tidecaller' | 'plaguewitch' | 'sludgewarlock' | 'juggernaut' | 'titan' | 'giant'
  | 'centaur' | 'minotaur' | 'harpy' | 'griffin' | 'pegasus' | 'cyclops' | 'hydra' | 'cerberus'
  | 'medusa' | 'nemean' | 'phoenix' | 'sphinx' | 'satyr' | 'chimera' | 'dragon' | 'beequeen' | 'bee'
  | 'mystery' | 'chicken' | 'spy'
  | 'imp' | 'fiend' | 'archfiend' | 'drake';
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
  /** a cloaked unit that only shows to enemies this close, in tiles, instead of CLOAK_DETECT (the Spy) */
  spot?: number;
  /**
   * a creature of Greek myth (data/creatures.ts). Wild ones guard lairs on the map; a side can only
   * train a kind once it has captured one.
   */
  beast?: boolean;
  /**
   * a demon from the Gate of Hell (data/hell.ts, game/hell.ts). Nobody trains demons: they belong to
   * no side, lurk round the gate and now and then raid the leader.
   */
  demon?: boolean;
  /** fraction of max health regained each second, whatever the side's healing research (the Hydra's wounds, the heavy machines' field repairs) */
  regen?: number;
  /** damage taken from arrows, bolts and bullets is multiplied by this (the Nemean Lion's hide); blades, blasts and boulders hurt in full */
  hide?: number;
  /** falls in flame and rises again from its ashes once per life (the Phoenix; see REBIRTH_HP in data/creatures.ts) */
  rebirth?: boolean;
  /** sees through enemy cloaks within this many tiles (the Sphinx) */
  detect?: number;
  /** heals every friendly foot soldier and creature within SONG_RANGE by this share of its health a second (the Satyr's pipes) */
  song?: number;
  /**
   * a spellcaster with its own robes and staff (render3d/arcane3d.ts). Like the hidden units it costs
   * Aether, so it stays hidden until its side first finds some, but it is no copy of a regular unit.
   */
  magic?: boolean;
  /** a spellcaster's spells, cast on their own when a fight calls for them (data/spells.ts, game/spells.ts) */
  spells?: SpellType[];
  /** most mana it can hold */
  mana?: number;
  /** a hulking walker of flesh and steel (render3d/arcane3d.ts): it strides on two legs and twists its torso to aim */
  cyborg?: boolean;
  /**
   * a towering giant of myth (render3d/giant3d.ts), several times the height of anything else on the
   * field. Rendered and animated on its own.
   */
  giant?: boolean;
  /**
   * a gun that must stand still this many seconds to dig in before it fires (the Artillery Tank): it
   * never fires on the move, and it backs off from anything inside its weapon's minRange
   */
  deploy?: number;
  /**
   * the Mystery Egg (game/mystery.ts): trained slowly like a unit, but what walks out of it is a random
   * special unit of the side's age, and now and then a Titan Chicken
   */
  hatches?: boolean;
  /**
   * calls up this many Bees at a time while it fights (the Bee Queen; see SWARM_* in data/creatures.ts).
   * They live a few seconds, fight what she fights, and fly home into her when she kneels or is captured.
   */
  swarm?: number;
  /**
   * a Sky Battleship: carries this many Hornets in its hangar, launches them at whatever comes near and
   * takes them back aboard when the fight is over. Each one lost is rebuilt aboard, very slowly
   * (CARRIER_* below; game/carrier.ts).
   */
  hangar?: number;
  /** only ever called up by another unit (a Bee by its Queen): never trained, short-lived, not counted as a unit lost or killed */
  summoned?: boolean;
  /** only ever comes out of a Mystery Egg: it can't be trained on its own (the Titan Chicken) */
  hatched?: boolean;
  /** enemies within this many tiles can't help going for it first, whatever else is about (the Titan Chicken) */
  lure?: number;
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
  /** most ore it carries per trip, if less than `haul` (Workers: Alex wants them to take less ore) */
  oreLoad?: number;
  /** ore dug per second, if slower than `scoop` (which is also how fast it loads oil) */
  oreScoop?: number;
  /** harvesters: ore scooped per second */
  scoop?: number;
  /** no longer trained from this age on (see data/era.ts) */
  until?: number;
  /**
   * a jet: it can't hover. It flies on at full speed, makes passes at its target (firing on the way in,
   * then flying on out and looping back for another), and circles when it has nothing to do (game/move.ts).
   */
  jet?: boolean;
  /** aircraft only: how high it flies, in tiles */
  alt?: number;
  /** preferred hotkey letter; otherwise one is picked from the name (views/game/hotkeys.ts) */
  key?: string;
  /** the hotkey sub-menu it sits in at its producer (views/game/hotkeys.ts); creatures and spellcasters get one by default */
  group?: string;
  desc: string;
}

export const UNIT: Record<UnitType, UnitDef> = {
  rifleman: { name: 'Rifleman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'rifle', cost: 100, wood: 20, t: 3, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Cheap infantry. Strong against infantry.' },
  gunner: { name: 'Machine Gunner', cls: 'infantry', armor: 'none', hp: 65, spd: 1.6, turn: 6, weapon: 'lmg', cost: 220, wood: 20, t: 7, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Belt-fed machine gun on a bipod. Mows down infantry and cavalry, but moves slowly.' },
  rocket: { name: 'Rocket Soldier', cls: 'infantry', armor: 'none', hp: 45, spd: 1.9, turn: 6.5, weapon: 'rocket', cost: 300, oil: 50, t: 9, era: 2, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Anti-armor infantry. Big, slow rockets that burst over a small area. Strong against vehicles.' },
  swordsman: { name: 'Footman', cls: 'infantry', armor: 'light', hp: 90, spd: 2.2, turn: 6.5, weapon: 'sword', cost: 175, t: 3, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Plate armor, sword and shield. Beats riflemen up close and shrugs off bullets.' },
  crossbowman: { name: 'Crossbowman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'crossbow', cost: 170, wood: 30, t: 6, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Armor-piercing bolts. Good against footmen and knights.' },
  medic: { name: 'Medic', cls: 'infantry', armor: 'none', hp: 60, spd: 2.2, turn: 6.5, weapon: null, cost: 200, t: 6, era: 0, requires: ['hospital'], sight: 8, producer: 'infantry', turret: false, radius: 6, desc: 'Unarmed. Heals wounded infantry, knights, creatures and anything that flies from up to 4 tiles away, so it can stay behind the front line. Research Field Mechanics at the Hospital and it repairs vehicles and cyborgs too.' },
  knight: { name: 'Knight', cls: 'infantry', armor: 'light', hp: 220, spd: 4.6, turn: 5, weapon: 'lance', cost: 400, wood: 50, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, desc: 'Armored horseman. Fast charges against infantry and harvesters.' },
  // the Guardian: a hulking foot soldier sealed in heavy plate behind a tower shield. A regular
  // Barracks unit (no Aether), far smaller than the Titan. It holds the line: arrows and bullets
  // barely mark it, and its giant axe chops through two foes at a swing. Rockets, cannons and spells bring it down.
  guardian: { name: 'Guardian', cls: 'infantry', armor: 'heavy', hp: 380, spd: 1.5, turn: 4, weapon: 'greataxe', cost: 550, wood: 50, t: 13, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 15, desc: 'Huge foot soldier in heavy plate with a tower shield and a giant axe it swings through the enemy line. Arrows and bullets barely scratch it, so it holds the front while others shoot. Slow; rockets, cannons and spells bring it down.' },
  // the Flamethrower: an Industrial trooper with fuel tanks on his back and a hose that spits a short
  // jet of burning oil. Too short-ranged for a stand-up fight, but every lick sets its target alight
  // and the fire runs on through packed troops. Burns out bunched infantry, creatures and buildings;
  // tanks and Tide Callers make short work of him.
  flamer: { name: 'Flamethrower', cls: 'infantry', armor: 'light', hp: 110, spd: 2.0, turn: 6.5, weapon: 'flamethrower', cost: 250, oil: 60, t: 8, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Fuel tanks on his back and a hose of burning oil. Short reach, but everything he hits catches fire, and the fire spreads through packed troops. Clears out bunched infantry, creatures and buildings. Keep him away from tanks and water.' },
  jeep: { name: 'Scout Jeep', cls: 'vehicle', armor: 'light', hp: 210, spd: 5.0, turn: 4, weapon: 'mg', cost: 325, oil: 50, t: 10, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, desc: 'Fast scout with a machine gun.' },
  tank: { name: 'Battle Tank', key: 'T', cls: 'vehicle', armor: 'heavy', hp: 360, spd: 3.0, turn: 2.5, weapon: 'cannon', cost: 700, oil: 150, t: 20, era: 1, sight: 5, producer: 'vehicle', turret: true, radius: 13, desc: 'Main battle tank. Strong against vehicles and buildings.' },
  heavy: { name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.0, turn: 1.8, weapon: 'heavycannon', cost: 1200, oil: 200, t: 31, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, regen: 0.005, desc: 'Slow, heavily armored twin-cannon tank. Its crew patch it up in the field: it slowly repairs itself.' },
  catapult: { name: 'Catapult', cls: 'vehicle', armor: 'light', hp: 220, spd: 1.6, turn: 1.5, weapon: 'catapult', cost: 400, wood: 300, t: 15, era: 0, sight: 6, producer: 'vehicle', turret: false, radius: 14, desc: 'Lobs boulders from long range. Crushes buildings and packed infantry.' },
  artillery: { name: 'Artillery Tank', cls: 'vehicle', armor: 'light', hp: 340, spd: 2.4, turn: 2, weapon: 'howitzer', cost: 600, oil: 150, t: 18, era: 1, sight: 6, producer: 'vehicle', turret: true, radius: 13, deploy: 1.5, desc: 'Self-propelled howitzer. Shells from 10 tiles away, beyond the reach of towers and turrets, and wrecks packed troops and defenses. Must stop and dig in before it fires, can\'t hit anything within 3 tiles and is thinly armored: keep it behind the front.' },
  harvester: { name: 'Harvester', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.4, turn: 2, weapon: null, cost: 1400, wood: 100, t: 20, era: 2, sight: 4, producer: 'vehicle', turret: false, radius: 15, haul: 600, scoop: 125, desc: 'Collects ore and brings it to a Refinery or the Town Hall. Unarmed.' },
  worker: { name: 'Worker', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'pick', cost: 250, t: 7, era: 0, sight: 4, producer: 'infantry', turret: false, radius: 6, haul: 300, oreLoad: 150, scoop: 80, oreScoop: 38, desc: 'Builds every structure, digs ore, chops wood and hauls oil home. When idle it repairs buildings and patches up wounded troops. Harvesters take over the ore in the Modern age.' },
  // aircraft, built at the Airfield. They fly straight over buildings, cliffs and water, and only
  // weapons that can aim upward (bows, guns, rockets, flak) can hit them.
  balloon: { name: 'War Balloon', cls: 'air', armor: 'air', hp: 170, spd: 1.3, turn: 1, weapon: 'bomb', cost: 120, wood: 180, t: 8, era: 1, sight: 9, producer: 'air', turret: false, radius: 12, alt: 2.2, desc: 'Silk envelope and a wicker basket. Drifts slowly over walls and drops bombs. Sees far.' },
  biplane: { name: 'Biplane', cls: 'air', armor: 'air', hp: 190, spd: 6.0, turn: 2.5, weapon: 'planegun', cost: 300, wood: 150, oil: 100, t: 14, era: 1, sight: 8, producer: 'air', turret: false, radius: 12, alt: 1.6, desc: 'Fast wood-and-canvas fighter. Shreds balloons, aircraft and infantry.' },
  helicopter: { name: 'Attack Helicopter', cls: 'air', armor: 'air', hp: 340, spd: 4.4, turn: 3.5, weapon: 'missile', cost: 700, oil: 300, t: 26, era: 2, sight: 7, producer: 'air', turret: false, radius: 13, alt: 1.3, desc: 'Steel gunship firing guided missiles. Deadly against tanks.' },
  drone: { name: 'Combat Drone', cls: 'air', armor: 'air', hp: 70, spd: 7.0, turn: 7, weapon: 'dronegun', cost: 200, oil: 60, t: 5, era: 2, sight: 8, producer: 'air', turret: false, radius: 8, alt: 1.1, desc: 'Cheap, fast quadcopter with a light gun. Send them in swarms; flak, rifles and machine guns knock them down.' },
  // jets: the fastest things in the sky, and they can't hover. They make passes at a target and loop back round.
  fighter: { name: 'Jet Fighter', cls: 'air', armor: 'air', hp: 280, spd: 9.5, turn: 2.6, weapon: 'aam', cost: 650, oil: 200, t: 21, era: 2, sight: 10, producer: 'air', turret: false, radius: 13, alt: 1.8, jet: true, desc: 'Supersonic interceptor with heat-seeking missiles. Hunts helicopters, drones, balloons and flying creatures, and outruns anything in the sky. Can\'t hit the ground, and can\'t hover: it makes passes and loops back.' },
  striker: { name: 'Strike Jet', cls: 'air', armor: 'air', hp: 340, spd: 8.0, turn: 1.9, weapon: 'jetbomb', cost: 1000, oil: 300, t: 31, era: 2, sight: 8, producer: 'air', turret: false, radius: 15, alt: 1.8, jet: true, desc: 'Swoops in low and drops a heavy bomb, then streaks away and loops back for another run. Wrecks buildings, turrets and tanks from across the map. Can\'t hover or fight other aircraft; flak and fighters bring it down.' },
  // the Sky Battleship (internal `carrier`): a huge, slow flying warship with big guns that also launches its own wing of little Hornet jets
  carrier: { name: 'Sky Battleship', cls: 'air', armor: 'air', hp: 1600, spd: 2.0, turn: 0.8, weapon: 'carriergun', cost: 2400, oil: 700, t: 90, era: 2, sight: 11, producer: 'air', turret: true, radius: 28, alt: 2.6, hangar: 4, desc: 'A flying battleship, slow to build and slow in the air. Two armored triple-gun turrets shell troops, tanks and buildings below, and the flight deck at its stern carries four Hornets that it launches at anything within 8 tiles and takes back aboard after the fight. A Hornet that is shot down is rebuilt aboard, but very slowly, one every 75 seconds. Its big guns barely touch other aircraft: Jet Fighters, Flak and Missile Turrets bring it down.' },
  hornet: { name: 'Hornet', cls: 'air', armor: 'air', hp: 80, spd: 8.0, turn: 5, weapon: 'hornetgun', cost: 0, t: 1, era: 2, sight: 7, producer: 'air', turret: false, radius: 9, alt: 1.6, hatched: true, summoned: true, desc: 'A little jet flown off a Sky Battleship. Only a Battleship launches them; they fight what it fights, hit ground and air alike, and fly home to it when the fight is over.' },
  // the Spy (Alex, 2026-11-27): a Modern-age infiltrator for watching other sides. It never fights; it
  // stays cloaked (only Ward Stones, Sphinxes, other Spies and enemies all but on top of it see it),
  // sees far, and runs when it's shot at.
  spy: { name: 'Spy', cls: 'infantry', armor: 'none', hp: 70, spd: 2.8, turn: 7, weapon: null, cost: 250, oil: 75, t: 9, era: 2, sight: 11, producer: 'infantry', turret: false, radius: 6, cloak: true, spot: 1, detect: 4, desc: 'Unarmed infiltrator in a camouflage suit. Enemies can\'t see it unless they all but bump into it, and it sees far, so park it by an enemy base to watch what they build and where their army goes. Never attacks, and runs if it\'s shot at. Spots other cloaked units within 4 tiles. Ward Stones and Sphinxes see through its disguise.' },
  // hidden units, revealed by Aether: each matches its regular unit, plus one trick
  wraith: { name: 'Wraith Knight', cls: 'infantry', armor: 'light', hp: 240, spd: 4.6, turn: 5, weapon: 'wraithlance', cost: 350, wood: 30, aether: 50, t: 13, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, look: 'knight', desc: 'A knight bound to Aether. Its spectral lance passes through armor.' },
  hexblade: { name: 'Hex Rifleman', cls: 'infantry', armor: 'none', hp: 57, spd: 2.0, turn: 6.5, weapon: 'hexrifle', cost: 100, wood: 20, aether: 10, t: 4, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, look: 'rifleman', desc: 'Hexed shot slows whatever it hits to half speed for a moment.' },
  phantom: { name: 'Phantom Jeep', cls: 'vehicle', armor: 'light', hp: 240, spd: 5.0, turn: 4, weapon: 'mg', cost: 350, oil: 50, aether: 40, t: 13, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, cloak: true, look: 'jeep', desc: 'Scout jeep wrapped in Aether. Unseen until it fires or an enemy comes close.' },
  starfall: { name: 'Starfall Tank', cls: 'vehicle', armor: 'heavy', hp: 410, spd: 2.8, turn: 2.5, weapon: 'starbeam', cost: 700, oil: 150, aether: 70, t: 25, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 13, look: 'tank', desc: 'Battle tank with a beam of starlight. Slow to fire, but tears through buildings.' },
  // spellcasters: regular Barracks troops (no Aether), paid in ore and wood. One per age,
  // each a little stronger and stranger than the last. Robes don't stop bullets.
  mage: { name: 'Battle Mage', cls: 'infantry', armor: 'none', hp: 90, spd: 2.0, turn: 6.5, weapon: 'fireball', cost: 310, wood: 45, t: 8, era: 0, sight: 6, producer: 'infantry', requires: ['magetower'], turret: false, radius: 6, magic: true, mana: 100, spells: ['bloodlust'], desc: 'Hurls fireballs that burst over a crowd and set it burning. Casts Bloodlust on troops in a fight.' },
  stormcaller: { name: 'Storm Caller', cls: 'infantry', armor: 'none', hp: 110, spd: 2.0, turn: 6.5, weapon: 'lightning', cost: 540, wood: 80, t: 12, era: 1, sight: 6, producer: 'infantry', requires: ['magetower'], turret: false, radius: 6, magic: true, mana: 120, spells: ['bloodlust', 'slow'], desc: 'Calls down lightning that leaps from its target to two more foes nearby, and hits wet foes far harder. Strikes aircraft too. Casts Bloodlust and Slow.' },
  archmage: { name: 'Archmage', cls: 'infantry', armor: 'light', hp: 160, spd: 1.8, turn: 6, weapon: 'meteor', cost: 650, wood: 80, oil: 40, t: 17, era: 2, sight: 8, producer: 'infantry', requires: ['magetower'], turret: false, radius: 7, magic: true, mana: 200, spells: ['shield', 'bloodlust', 'slow', 'freeze'], desc: 'Pulls a burning star down on a spot far away. Slow to cast, and the meteor lands where the foe stood, but it wrecks bases. Casts Shield, Bloodlust and Slow, and saves its mana to Freeze a strong enemy.' },
  // elemental casters: one water, one poison, one sludge
  tidecaller: { name: 'Tide Caller', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'tidal', cost: 300, wood: 45, t: 7, era: 0, sight: 6, producer: 'infantry', requires: ['magetower'], turret: false, radius: 6, magic: true, mana: 150, spells: ['douse', 'shield', 'freeze'], desc: 'Hurls waves that knock aircraft down and hit fire-wielders (Battle Mages, Cerberus, Phoenix) far harder. Water puts out fire and poison and washes off sludge, but leaves foes wet for lightning. Douses burning or poisoned friends, Shields friends under fire, and saves its mana to Freeze a strong enemy.' },
  plaguewitch: { name: 'Plague Witch', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'plague', cost: 300, wood: 50, t: 8, era: 1, sight: 6, producer: 'infantry', requires: ['magetower'], turret: false, radius: 6, magic: true, mana: 120, spells: ['slow'], desc: 'Throws flasks of green poison gas. Poison eats through armor, so it melts knights, giants and creatures, but it only harms living things, not vehicles or machines. Casts Slow.' },
  sludgewarlock: { name: 'Sludge Warlock', cls: 'infantry', armor: 'light', hp: 190, spd: 1.8, turn: 6, weapon: 'tar', cost: 450, wood: 60, oil: 20, t: 12, era: 2, sight: 6, producer: 'infantry', requires: ['magetower'], turret: false, radius: 7, magic: true, mana: 120, spells: ['bloodlust'], desc: 'Splashes a crowd with black sludge that slows it, gums up its weapons and makes it burn hotter. Strong against packed infantry and vehicles. Pair it with fire. Casts Bloodlust.' },
  // cyborgs: Modern-age giants, half soldier, half war machine, built at the War Factory. Huge,
  // slow and costly, they wade through small-arms fire; rockets and anti-tank missiles bring them down.
  juggernaut: { name: 'Cyborg Juggernaut', key: 'J', cls: 'vehicle', armor: 'heavy', hp: 900, spd: 2.2, turn: 3, weapon: 'minigun', cost: 1350, oil: 175, t: 29, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, cyborg: true, regen: 0.005, desc: 'A towering cyborg with a rotary cannon for an arm. Mows down infantry, shrugs off bullets and slowly repairs itself.' },
  titan: { name: 'Cyborg Colossus', key: 'I', cls: 'vehicle', armor: 'heavy', hp: 1500, spd: 1.6, turn: 1.8, weapon: 'railgun', cost: 2000, oil: 350, t: 50, era: 2, sight: 7, producer: 'vehicle', turret: true, radius: 26, cyborg: true, regen: 0.005, desc: 'The biggest thing on the field. Twin rail cannons punch through tanks and buildings. Can\'t hit aircraft. Slowly repairs itself.' },
  // the Titan: one per side, the largest thing in the game. An elder giant of bronze and stone, woken
  // with Aether. It sweeps a huge club through up to three foes in front of it; only aircraft are
  // safe from it, and massed rockets and anti-tank fire are the way to bring it down.
  giant: { name: 'Titan', cls: 'infantry', armor: 'heavy', hp: 3000, spd: 1.6, turn: 2.2, weapon: 'quake', cost: 3600, wood: 400, aether: 150, t: 90, era: 1, sight: 8, producer: 'infantry', turret: false, radius: 44, giant: true, limit: 1, group: 'Magic', desc: 'A bare-chested giant woken with Aether, taller than any building. It swings a huge club in a wide sweep that hits up to three foes in front of it and crushes buildings. Only one at a time. Can\'t hit aircraft.' },
  // the Mystery Egg: a slow gamble on Aether. It hatches into a random special unit (game/mystery.ts):
  // a Titan, a Dragon, a Cyborg Colossus... or a Titan Chicken. One at a time.
  mystery: { name: 'Mystery Egg', cls: 'infantry', armor: 'none', hp: 1, spd: 0, turn: 0, weapon: null, cost: 600, aether: 80, t: 90, era: 0, sight: 1, producer: 'infantry', turret: false, radius: 8, hatches: true, limit: 1, group: 'Magic', desc: 'A glowing egg warmed slowly on Aether. Hatches into a random special unit of your age: maybe a Titan, a Dragon or a Cyborg Colossus, maybe something cheaper. Now and then it\'s a Titan Chicken. One at a time, and it takes a long while.' },
  // the Titan Chicken: what sometimes comes out of a Mystery Egg instead. A barn-sized chicken that
  // every enemy nearby can't help going for, so the army behind it walks in untouched.
  chicken: { name: 'Titan Chicken', cls: 'infantry', armor: 'light', hp: 1600, spd: 3.4, turn: 4, weapon: 'peck', cost: 600, aether: 80, t: 90, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 22, hatched: true, lure: 5, regen: 0.004, desc: 'A chicken the size of a barn. Only ever hatches from a Mystery Egg. Every enemy within 5 tiles can\'t help going for it, so it soaks up the fire while your army does the work, and its stomping peck scatters infantry. Feathers stop nothing, but there are a lot of them. It can\'t reach anything that flies.' },
  // creatures of Greek myth, found wild in lairs on the map (data/creatures.ts). Capture one and the
  // side can train more of its kind for ore and Aether, in any age. Flyers come from the Airfield.
  centaur: { name: 'Centaur', cls: 'infantry', armor: 'light', hp: 260, spd: 4.2, turn: 5, weapon: 'centaurbow', cost: 300, wood: 40, aether: 35, t: 11, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 17, beast: true, desc: 'Half man, half horse. A fast archer that shoots on the gallop. Strong against infantry and fliers.' },
  minotaur: { name: 'Minotaur', cls: 'infantry', armor: 'light', hp: 460, spd: 2.4, turn: 4, weapon: 'axe', cost: 450, aether: 45, t: 13, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 19, beast: true, desc: 'Bull-headed brute with a great double axe. Slow, tough, and smashes buildings.' },
  cyclops: { name: 'Cyclops', cls: 'infantry', armor: 'heavy', hp: 400, spd: 1.8, turn: 3, weapon: 'hurl', cost: 650, aether: 70, t: 19, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 24, beast: true, desc: 'One-eyed giant who hurls boulders from long range. Crushes tanks and walls.' },
  hydra: { name: 'Hydra', cls: 'infantry', armor: 'light', hp: 450, spd: 1.6, turn: 3, weapon: 'hydrabite', cost: 600, aether: 60, t: 17, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 22, beast: true, regen: 0.012, desc: 'Many-headed serpent. Bites three foes at once and keeps growing back its wounds.' },
  cerberus: { name: 'Cerberus', cls: 'infantry', armor: 'light', hp: 380, spd: 4.0, turn: 5.5, weapon: 'hellfire', cost: 500, aether: 50, t: 15, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 19, beast: true, desc: 'Three-headed hound of the underworld. Breathes fire over a crowd of infantry.' },
  harpy: { name: 'Harpy', cls: 'air', armor: 'air', hp: 105, spd: 6.0, turn: 5, weapon: 'talons', cost: 200, aether: 25, t: 7, era: 0, sight: 8, producer: 'air', turret: false, radius: 14, alt: 1.4, beast: true, desc: 'Shrieking winged hag. Swoops on harvesters and infantry; easy prey for archers.' },
  pegasus: { name: 'Pegasus', cls: 'air', armor: 'air', hp: 190, spd: 6.5, turn: 4, weapon: 'hoof', cost: 400, aether: 45, t: 13, era: 0, sight: 10, producer: 'air', turret: false, radius: 19, alt: 1.6, beast: true, desc: 'Winged horse. The fastest thing in the sky, it charges down on foes and sees far.' },
  griffin: { name: 'Griffin', cls: 'air', armor: 'air', hp: 230, spd: 4.8, turn: 3.5, weapon: 'griffclaw', cost: 500, aether: 55, t: 15, era: 0, sight: 8, producer: 'air', turret: false, radius: 20, alt: 1.5, beast: true, desc: 'Eagle-lion that dives on vehicles and tears aircraft out of the sky.' },
  medusa: { name: 'Medusa', cls: 'infantry', armor: 'light', hp: 240, spd: 2.0, turn: 5, weapon: 'gaze', cost: 400, aether: 40, t: 12, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 16, beast: true, desc: 'Snake-haired gorgon. Her gaze cracks armor and turns a foe to stone for a few seconds, so it can\'t move or fight. The creature that stops tanks and giants cold.' },
  nemean: { name: 'Nemean Lion', cls: 'infantry', armor: 'light', hp: 420, spd: 3.2, turn: 5, weapon: 'lionclaw', cost: 500, aether: 50, t: 15, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 19, beast: true, hide: 0.3, desc: 'Its golden hide turns arrows and bullets. Walks through archers, gunners and towers; only blades, claws, shells and blasts really hurt it.' },
  sphinx: { name: 'Sphinx', cls: 'infantry', armor: 'light', hp: 320, spd: 2.6, turn: 4.5, weapon: 'sphinxclaw', cost: 360, aether: 40, t: 12, era: 0, sight: 9, producer: 'infantry', turret: false, radius: 19, beast: true, detect: 7, desc: 'Winged lion with a woman\'s face. Nothing hides from her: she sees cloaked units within 7 tiles, and sees far. Guards a base or leads a hunt for hidden foes.' },
  satyr: { name: 'Satyr', cls: 'infantry', armor: 'none', hp: 150, spd: 3.4, turn: 6, weapon: 'thyrsus', cost: 150, aether: 15, t: 6, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, beast: true, song: 0.015, desc: 'Goat-legged piper, cheap and quick. His tune heals every friendly foot soldier and creature around him, so a band of Satyrs keeps itself on its feet and overruns archers and gunners. Little use against armor.' },
  chimera: { name: 'Chimera', cls: 'infantry', armor: 'light', hp: 360, spd: 3.0, turn: 4.5, weapon: 'chimerafire', cost: 500, aether: 50, t: 15, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 20, beast: true, desc: 'Lion, goat and serpent in one. Its fire breath reaches up into the sky: the creature that burns flyers down.' },
  phoenix: { name: 'Phoenix', cls: 'air', armor: 'air', hp: 200, spd: 5.0, turn: 4, weapon: 'phoenixfire', cost: 450, aether: 60, t: 15, era: 0, sight: 8, producer: 'air', turret: false, radius: 17, alt: 1.5, beast: true, rebirth: true, desc: 'Firebird. Showers flame on the ground below, and when it falls it bursts alight and rises again from its ashes, once.' },
  dragon: { name: 'Dragon', cls: 'air', armor: 'air', hp: 440, spd: 3.6, turn: 2.8, weapon: 'dragonfire', cost: 800, aether: 90, t: 23, era: 0, sight: 8, producer: 'air', turret: false, radius: 28, alt: 1.9, beast: true, hide: 0.6, desc: 'Great serpent of the sky that guards treasure (Ladon, who coiled round the golden apples). Its breath melts armor and sets whole bases ablaze, and arrows and bullets glance off its scales. Can\'t fight other flyers: send Flak, rockets, a Chimera or a Griffin against it.' },
  beequeen: { name: 'Bee Queen', cls: 'air', armor: 'air', hp: 440, spd: 2.8, turn: 2.6, weapon: 'sting', cost: 600, aether: 70, t: 19, era: 0, sight: 8, producer: 'air', turret: false, radius: 28, alt: 1.4, beast: true, swarm: 3, desc: 'A bee the size of a horse, crowned in gold. As she fights she calls up her swarm, a few Bees at a time, and their stings and hers poison living things straight through armor. The Bees soak up the fire meant for her and swarm over archers and footmen. Poison does nothing to machines: tanks and towers shrug her off, and Flak and archers swat the swarm.' },
  bee: { name: 'Bee', cls: 'air', armor: 'air', hp: 24, spd: 6.0, turn: 9, weapon: 'beesting', cost: 0, t: 1, era: 0, sight: 5, producer: 'air', turret: false, radius: 6, alt: 1.0, beast: true, hatched: true, summoned: true, desc: 'One of the Bee Queen\'s swarm. Only she can call it up, and it lives a few seconds: its sting poisons living things.' },
  // demons out of the Gate of Hell in the middle of the map (data/hell.ts). They can't be trained and
  // fight for nobody: they wait by the gate and now and then raid the side with the strongest army.
  imp: { name: 'Imp', cls: 'infantry', armor: 'light', hp: 130, spd: 3.6, turn: 6, weapon: 'impfire', cost: 150, t: 1, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 9, demon: true, desc: 'A little red devil from the Gate of Hell. Quick, and spits fire.' },
  fiend: { name: 'Hell Fiend', cls: 'infantry', armor: 'light', hp: 480, spd: 2.6, turn: 4, weapon: 'fiendclaw', cost: 450, t: 1, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 15, demon: true, regen: 0.004, desc: 'A horned brute from the Gate of Hell. Tears through troops and walls with its claws.' },
  archfiend: { name: 'Archfiend', cls: 'infantry', armor: 'heavy', hp: 3400, spd: 1.6, turn: 2, weapon: 'hellblade', cost: 2500, t: 1, era: 0, sight: 8, producer: 'infantry', turret: false, radius: 26, demon: true, regen: 0.003, desc: 'A giant demon that climbs out of the Gate of Hell only now and then. Its burning blade cleaves everything around the blow. Can\'t hit aircraft.' },
  drake: { name: 'Hell Drake', cls: 'air', armor: 'air', hp: 300, spd: 4.2, turn: 3, weapon: 'drakefire', cost: 500, t: 1, era: 0, sight: 8, producer: 'air', turret: false, radius: 20, alt: 1.6, demon: true, desc: 'A winged wyrm out of the Gate of Hell. Flies over walls and rains fire on troops and buildings. Flak, archers, rockets and fighters bring it down.' },
};

/** Medics heal this many hit points a second, from up to MEDIC_REACH px away, so they can stay behind the front. */
export const MEDIC_HEAL = 4;
export const MEDIC_REACH = 4 * 32;
/** How close a Worker stands to the unit it patches up, px. */
export const MEDIC_RANGE = 20;
/** A Worker patches up a hurt unit this many hit points a second (half a Medic). */
export const WORKER_HEAL = 2;
/** A Worker repairs a damaged building this many hit points a second (paying ore like the Repair button; Alex, 2026-11-28: "Repair is too fast", was 10). */
export const WORKER_REPAIR = 5;
/** Medics and Workers fix vehicles and cyborgs at this share of their healing speed (Alex, 2026-11-28: "Repair is too fast"). */
export const MACHINE_REPAIR = 0.5;
/**
 * Sites only go up while Workers build them: each Worker on a site builds this much of it per second
 * of its build time (1 = one Worker builds it in its build time, two in half that).
 */
export const WORKER_BUILD = 1;

/** Every unit sees this much further than its listed sight (fog of war only; how far it looks for a fight is unchanged). */
export const UNIT_SIGHT_BOOST = 1.3;

export const UNIT_TYPES = Object.keys(UNIT) as UnitType[];

export const isUnitType = (t: string): t is UnitType => t in UNIT;

/** a Sky Battleship sends its Hornets after foes this many tiles from it, and calls them home past it */
export const CARRIER_REACH = 8;
/** seconds between Hornets taking off */
export const CARRIER_LAUNCH_EVERY = 0.7;
/** seconds to rebuild one lost Hornet aboard (Alex: very, very slowly) */
export const CARRIER_REBUILD = 75;
