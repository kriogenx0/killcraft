import type { ArmorClass, WeaponType } from './weapon.ts';
import type { BldType } from './building.ts';
import type { SpellType } from './spells.ts';

export type UnitType = 'rifleman' | 'gunner' | 'rocket' | 'swordsman' | 'crossbowman' | 'knight' | 'jeep' | 'tank' | 'heavy' | 'catapult' | 'artillery' | 'harvester' | 'worker'
  | 'balloon' | 'biplane' | 'helicopter' | 'drone' | 'fighter' | 'striker' | 'medic'
  | 'wraith' | 'hexblade' | 'phantom' | 'starfall'
  | 'mage' | 'stormcaller' | 'archmage' | 'tidecaller' | 'plaguewitch' | 'sludgewarlock' | 'juggernaut' | 'titan' | 'giant'
  | 'centaur' | 'minotaur' | 'harpy' | 'griffin' | 'pegasus' | 'cyclops' | 'hydra' | 'cerberus'
  | 'medusa' | 'nemean' | 'phoenix' | 'sphinx' | 'satyr' | 'chimera' | 'dragon' | 'unicorn';
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
  /** lifts burns, poison, ice, curses, hexes and stone off every friendly unit within this many tiles, about once a second (the Unicorn) */
  cleanse?: number;
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
  rifleman: { name: 'Rifleman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'rifle', cost: 100, wood: 20, t: 5, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Cheap infantry. Strong against infantry.' },
  gunner: { name: 'Machine Gunner', cls: 'infantry', armor: 'none', hp: 65, spd: 1.6, turn: 6, weapon: 'lmg', cost: 250, wood: 20, t: 8, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Belt-fed machine gun on a bipod. Mows down infantry and cavalry, but moves slowly.' },
  rocket: { name: 'Rocket Soldier', cls: 'infantry', armor: 'none', hp: 45, spd: 1.9, turn: 6.5, weapon: 'rocket', cost: 300, oil: 50, t: 8, era: 2, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Anti-armor infantry. Big, slow rockets that burst over a small area. Strong against vehicles.' },
  swordsman: { name: 'Footman', cls: 'infantry', armor: 'light', hp: 90, spd: 2.2, turn: 6.5, weapon: 'sword', cost: 175, t: 6, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 6, desc: 'Plate armor, sword and shield. Beats riflemen up close and shrugs off bullets.' },
  crossbowman: { name: 'Crossbowman', cls: 'infantry', armor: 'none', hp: 50, spd: 2.0, turn: 6.5, weapon: 'crossbow', cost: 170, wood: 30, t: 7, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Armor-piercing bolts. Good against footmen and knights.' },
  medic: { name: 'Medic', cls: 'infantry', armor: 'none', hp: 60, spd: 2.2, turn: 6.5, weapon: null, cost: 200, t: 7, era: 0, requires: ['hospital'], sight: 6, producer: 'infantry', turret: false, radius: 6, desc: 'Unarmed. Heals wounded infantry, knights, creatures and anything that flies from up to 4 tiles away, so it can stay behind the front line.' },
  knight: { name: 'Knight', cls: 'infantry', armor: 'light', hp: 220, spd: 4.6, turn: 5, weapon: 'lance', cost: 400, wood: 50, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, desc: 'Armored horseman. Fast charges against infantry and harvesters.' },
  jeep: { name: 'Scout Jeep', cls: 'vehicle', armor: 'light', hp: 210, spd: 5.0, turn: 4, weapon: 'mg', cost: 325, oil: 50, t: 9, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, desc: 'Fast scout with a machine gun.' },
  tank: { name: 'Battle Tank', key: 'T', cls: 'vehicle', armor: 'heavy', hp: 360, spd: 3.0, turn: 2.5, weapon: 'cannon', cost: 700, oil: 150, t: 14, era: 1, sight: 5, producer: 'vehicle', turret: true, radius: 13, desc: 'Main battle tank. Strong against vehicles and buildings.' },
  heavy: { name: 'Heavy Tank', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.0, turn: 1.8, weapon: 'heavycannon', cost: 1200, oil: 200, t: 22, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, regen: 0.005, desc: 'Slow, heavily armored twin-cannon tank. Its crew patch it up in the field: it slowly repairs itself.' },
  catapult: { name: 'Catapult', cls: 'vehicle', armor: 'light', hp: 220, spd: 1.6, turn: 1.5, weapon: 'catapult', cost: 400, wood: 300, t: 16, era: 0, sight: 6, producer: 'vehicle', turret: false, radius: 14, desc: 'Lobs boulders from long range. Crushes buildings and packed infantry.' },
  artillery: { name: 'Artillery Tank', cls: 'vehicle', armor: 'light', hp: 260, spd: 2.4, turn: 2, weapon: 'howitzer', cost: 600, oil: 150, t: 15, era: 1, sight: 6, producer: 'vehicle', turret: true, radius: 13, deploy: 1.5, desc: 'Self-propelled howitzer. Shells from 10 tiles away, beyond the reach of towers and turrets, and wrecks packed troops and defenses. Must stop and dig in before it fires, can\'t hit anything within 3 tiles and is thinly armored: keep it behind the front.' },
  harvester: { name: 'Harvester', cls: 'vehicle', armor: 'heavy', hp: 700, spd: 2.4, turn: 2, weapon: null, cost: 1400, wood: 100, t: 18, era: 2, sight: 4, producer: 'vehicle', turret: false, radius: 15, haul: 600, scoop: 160, desc: 'Collects ore and brings it to a Refinery or the Town Hall. Unarmed.' },
  worker: { name: 'Worker', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'pick', cost: 250, t: 7, era: 0, sight: 4, producer: 'infantry', turret: false, radius: 6, haul: 300, oreLoad: 150, scoop: 80, oreScoop: 50, desc: 'Builds every structure, digs ore, chops wood and hauls oil home. When idle it repairs buildings and patches up wounded troops. Harvesters take over the ore in the Modern age.' },
  // aircraft, built at the Airfield. They fly straight over buildings, cliffs and water, and only
  // weapons that can aim upward (bows, guns, rockets, flak) can hit them.
  balloon: { name: 'War Balloon', cls: 'air', armor: 'air', hp: 170, spd: 1.3, turn: 1, weapon: 'bomb', cost: 150, wood: 200, t: 12, era: 1, sight: 9, producer: 'air', turret: false, radius: 12, alt: 2.2, desc: 'Silk envelope and a wicker basket. Drifts slowly over walls and drops bombs. Sees far.' },
  biplane: { name: 'Biplane', cls: 'air', armor: 'air', hp: 190, spd: 6.0, turn: 2.5, weapon: 'planegun', cost: 300, wood: 150, oil: 100, t: 13, era: 1, sight: 8, producer: 'air', turret: false, radius: 12, alt: 1.6, desc: 'Fast wood-and-canvas fighter. Shreds balloons, aircraft and infantry.' },
  helicopter: { name: 'Attack Helicopter', cls: 'air', armor: 'air', hp: 340, spd: 4.4, turn: 3.5, weapon: 'missile', cost: 700, oil: 300, t: 18, era: 2, sight: 7, producer: 'air', turret: false, radius: 13, alt: 1.3, desc: 'Steel gunship firing guided missiles. Deadly against tanks.' },
  drone: { name: 'Combat Drone', cls: 'air', armor: 'air', hp: 70, spd: 7.0, turn: 7, weapon: 'dronegun', cost: 200, oil: 60, t: 6, era: 2, sight: 8, producer: 'air', turret: false, radius: 8, alt: 1.1, desc: 'Cheap, fast quadcopter with a light gun. Send them in swarms; flak, rifles and machine guns knock them down.' },
  // jets: the fastest things in the sky, and they can't hover. They make passes at a target and loop back round.
  fighter: { name: 'Jet Fighter', cls: 'air', armor: 'air', hp: 280, spd: 9.5, turn: 2.6, weapon: 'aam', cost: 650, oil: 200, t: 16, era: 2, sight: 10, producer: 'air', turret: false, radius: 13, alt: 1.8, jet: true, desc: 'Supersonic interceptor with heat-seeking missiles. Hunts helicopters, drones, balloons and flying creatures, and outruns anything in the sky. Can\'t hit the ground, and can\'t hover: it makes passes and loops back.' },
  striker: { name: 'Strike Jet', cls: 'air', armor: 'air', hp: 340, spd: 8.0, turn: 1.9, weapon: 'jetbomb', cost: 1000, oil: 300, t: 20, era: 2, sight: 8, producer: 'air', turret: false, radius: 15, alt: 1.8, jet: true, desc: 'Swoops in low and drops a heavy bomb, then streaks away and loops back for another run. Wrecks buildings, turrets and tanks from across the map. Can\'t hover or fight other aircraft; flak and fighters bring it down.' },
  // hidden units, revealed by Aether: each matches its regular unit, plus one trick
  wraith: { name: 'Wraith Knight', cls: 'infantry', armor: 'light', hp: 240, spd: 4.6, turn: 5, weapon: 'wraithlance', cost: 350, wood: 30, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, look: 'knight', desc: 'A knight bound to Aether. Its spectral lance passes through armor.' },
  hexblade: { name: 'Hex Rifleman', cls: 'infantry', armor: 'none', hp: 57, spd: 2.0, turn: 6.5, weapon: 'hexrifle', cost: 100, wood: 20, aether: 15, t: 6, era: 1, sight: 5, producer: 'infantry', turret: false, radius: 6, look: 'rifleman', desc: 'Hexed shot slows whatever it hits to half speed for a moment.' },
  phantom: { name: 'Phantom Jeep', cls: 'vehicle', armor: 'light', hp: 240, spd: 5.0, turn: 4, weapon: 'mg', cost: 350, oil: 50, aether: 40, t: 10, era: 1, sight: 7, producer: 'vehicle', turret: true, radius: 11, cloak: true, look: 'jeep', desc: 'Scout jeep wrapped in Aether. Unseen until it fires or an enemy comes close.' },
  starfall: { name: 'Starfall Tank', cls: 'vehicle', armor: 'heavy', hp: 410, spd: 2.8, turn: 2.5, weapon: 'starbeam', cost: 700, oil: 150, aether: 70, t: 16, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 13, look: 'tank', desc: 'Battle tank with a beam of starlight. Slow to fire, but tears through buildings.' },
  // spellcasters: they draw on Aether, so they stay hidden until their side finds some. One per age,
  // each a little stronger and stranger than the last. Robes don't stop bullets.
  mage: { name: 'Battle Mage', cls: 'infantry', armor: 'none', hp: 90, spd: 2.0, turn: 6.5, weapon: 'fireball', cost: 250, aether: 30, t: 9, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, mana: 100, spells: ['bloodlust'], desc: 'Hurls fireballs that burst over a crowd and set it burning. Casts Bloodlust on troops in a fight.' },
  stormcaller: { name: 'Storm Caller', cls: 'infantry', armor: 'none', hp: 110, spd: 2.0, turn: 6.5, weapon: 'lightning', cost: 400, aether: 50, t: 11, era: 1, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, mana: 120, spells: ['bloodlust', 'slow'], desc: 'Calls down lightning that leaps from its target to two more foes nearby, and hits wet foes far harder. Strikes aircraft too. Casts Bloodlust and Slow.' },
  archmage: { name: 'Archmage', cls: 'infantry', armor: 'light', hp: 160, spd: 1.8, turn: 6, weapon: 'meteor', cost: 600, aether: 90, t: 16, era: 2, sight: 8, producer: 'infantry', turret: false, radius: 7, magic: true, mana: 200, spells: ['bloodlust', 'slow', 'freeze'], desc: 'Pulls a burning star down on a spot far away. Slow to cast, and the meteor lands where the foe stood, but it wrecks bases. Casts Bloodlust and Slow, and saves its mana to Freeze a strong enemy.' },
  // elemental casters: one water, one poison, one sludge
  tidecaller: { name: 'Tide Caller', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'tidal', cost: 225, aether: 30, t: 10, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, mana: 150, spells: ['douse', 'freeze'], desc: 'Hurls waves that knock aircraft down and hit fire-wielders (Battle Mages, Cerberus, Phoenix) far harder. Water puts out fire and poison and washes off sludge, but leaves foes wet for lightning. Douses burning or poisoned friends, and saves its mana to Freeze a strong enemy.' },
  plaguewitch: { name: 'Plague Witch', cls: 'infantry', armor: 'none', hp: 100, spd: 2.0, turn: 6.5, weapon: 'plague', cost: 275, aether: 35, t: 11, era: 1, sight: 6, producer: 'infantry', turret: false, radius: 6, magic: true, mana: 120, spells: ['slow'], desc: 'Throws flasks of green poison gas. Poison eats through armor, so it melts knights, giants and creatures, but it only harms living things, not vehicles or machines. Casts Slow.' },
  sludgewarlock: { name: 'Sludge Warlock', cls: 'infantry', armor: 'light', hp: 190, spd: 1.8, turn: 6, weapon: 'tar', cost: 400, aether: 45, t: 13, era: 2, sight: 6, producer: 'infantry', turret: false, radius: 7, magic: true, mana: 120, spells: ['bloodlust'], desc: 'Splashes a crowd with black sludge that slows it, gums up its weapons and makes it burn hotter. Strong against packed infantry and vehicles. Pair it with fire. Casts Bloodlust.' },
  // cyborgs: Modern-age giants, half soldier, half war machine, built at the War Factory. Huge,
  // slow and costly, they wade through small-arms fire; rockets and anti-tank missiles bring them down.
  juggernaut: { name: 'Cyborg Juggernaut', key: 'J', cls: 'vehicle', armor: 'heavy', hp: 900, spd: 2.2, turn: 3, weapon: 'minigun', cost: 1200, oil: 150, t: 20, era: 2, sight: 6, producer: 'vehicle', turret: true, radius: 15, cyborg: true, regen: 0.005, desc: 'A towering cyborg with a rotary cannon for an arm. Mows down infantry, shrugs off bullets and slowly repairs itself.' },
  titan: { name: 'Cyborg Colossus', key: 'I', cls: 'vehicle', armor: 'heavy', hp: 1500, spd: 1.6, turn: 1.8, weapon: 'railgun', cost: 2000, oil: 350, t: 32, era: 2, sight: 7, producer: 'vehicle', turret: true, radius: 19, cyborg: true, regen: 0.005, desc: 'The biggest thing on the field. Twin rail cannons punch through tanks and buildings. Can\'t hit aircraft. Slowly repairs itself.' },
  // the Titan: one per side, the largest thing in the game. An elder giant of bronze and stone, woken
  // with Aether. It smashes everything around it with a broken temple column; only aircraft are
  // safe from it, and massed rockets and anti-tank fire are the way to bring it down.
  giant: { name: 'Titan', cls: 'infantry', armor: 'heavy', hp: 3200, spd: 1.5, turn: 2.2, weapon: 'quake', cost: 2800, wood: 400, aether: 150, t: 50, era: 1, sight: 8, producer: 'infantry', turret: false, radius: 24, giant: true, limit: 1, group: 'Magic', desc: 'An elder giant of bronze and stone, woken with Aether. Its column smashes everything around the blow and crushes buildings. Only one at a time. Can\'t hit aircraft.' },
  // creatures of Greek myth, found wild in lairs on the map (data/creatures.ts). Capture one and the
  // side can train more of its kind for ore and Aether, in any age. Flyers come from the Airfield.
  centaur: { name: 'Centaur', cls: 'infantry', armor: 'light', hp: 260, spd: 4.2, turn: 5, weapon: 'centaurbow', cost: 300, wood: 40, aether: 35, t: 10, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 17, beast: true, desc: 'Half man, half horse. A fast archer that shoots on the gallop. Strong against infantry and fliers.' },
  minotaur: { name: 'Minotaur', cls: 'infantry', armor: 'light', hp: 460, spd: 2.4, turn: 4, weapon: 'axe', cost: 450, aether: 45, t: 12, era: 0, sight: 5, producer: 'infantry', turret: false, radius: 19, beast: true, desc: 'Bull-headed brute with a great double axe. Slow, tough, and smashes buildings.' },
  cyclops: { name: 'Cyclops', cls: 'infantry', armor: 'heavy', hp: 400, spd: 1.8, turn: 3, weapon: 'hurl', cost: 650, aether: 70, t: 16, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 24, beast: true, desc: 'One-eyed giant who hurls boulders from long range. Crushes tanks and walls.' },
  hydra: { name: 'Hydra', cls: 'infantry', armor: 'light', hp: 450, spd: 1.6, turn: 3, weapon: 'hydrabite', cost: 600, aether: 60, t: 15, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 22, beast: true, regen: 0.012, desc: 'Many-headed serpent. Bites three foes at once and keeps growing back its wounds.' },
  cerberus: { name: 'Cerberus', cls: 'infantry', armor: 'light', hp: 380, spd: 4.0, turn: 5.5, weapon: 'hellfire', cost: 500, aether: 50, t: 12, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 19, beast: true, desc: 'Three-headed hound of the underworld. Breathes fire over a crowd of infantry.' },
  harpy: { name: 'Harpy', cls: 'air', armor: 'air', hp: 105, spd: 6.0, turn: 5, weapon: 'talons', cost: 200, aether: 25, t: 8, era: 0, sight: 8, producer: 'air', turret: false, radius: 14, alt: 1.4, beast: true, desc: 'Shrieking winged hag. Swoops on harvesters and infantry; easy prey for archers.' },
  pegasus: { name: 'Pegasus', cls: 'air', armor: 'air', hp: 190, spd: 6.5, turn: 4, weapon: 'hoof', cost: 400, aether: 45, t: 11, era: 0, sight: 10, producer: 'air', turret: false, radius: 19, alt: 1.6, beast: true, desc: 'Winged horse. The fastest thing in the sky, it charges down on foes and sees far.' },
  griffin: { name: 'Griffin', cls: 'air', armor: 'air', hp: 230, spd: 4.8, turn: 3.5, weapon: 'griffclaw', cost: 500, aether: 55, t: 13, era: 0, sight: 8, producer: 'air', turret: false, radius: 20, alt: 1.5, beast: true, desc: 'Eagle-lion that dives on vehicles and tears aircraft out of the sky.' },
  medusa: { name: 'Medusa', cls: 'infantry', armor: 'light', hp: 240, spd: 2.0, turn: 5, weapon: 'gaze', cost: 400, aether: 40, t: 12, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 16, beast: true, desc: 'Snake-haired gorgon. Her gaze cracks armor and turns a foe to stone for a few seconds, so it can\'t move or fight. The creature that stops tanks and giants cold.' },
  nemean: { name: 'Nemean Lion', cls: 'infantry', armor: 'light', hp: 420, spd: 3.2, turn: 5, weapon: 'lionclaw', cost: 500, aether: 50, t: 13, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 19, beast: true, hide: 0.3, desc: 'Its golden hide turns arrows and bullets. Walks through archers, gunners and towers; only blades, claws, shells and blasts really hurt it.' },
  sphinx: { name: 'Sphinx', cls: 'infantry', armor: 'light', hp: 320, spd: 2.6, turn: 4.5, weapon: 'sphinxclaw', cost: 400, aether: 40, t: 12, era: 0, sight: 9, producer: 'infantry', turret: false, radius: 19, beast: true, detect: 7, desc: 'Winged lion with a woman\'s face. Nothing hides from her: she sees cloaked units within 7 tiles, and sees far. Guards a base or leads a hunt for hidden foes.' },
  satyr: { name: 'Satyr', cls: 'infantry', armor: 'none', hp: 150, spd: 3.4, turn: 6, weapon: 'thyrsus', cost: 150, aether: 15, t: 7, era: 0, sight: 6, producer: 'infantry', turret: false, radius: 11, beast: true, song: 0.015, desc: 'Goat-legged piper, cheap and quick. His tune heals every friendly foot soldier and creature around him, so a band of Satyrs keeps itself on its feet and overruns archers and gunners. Little use against armor.' },
  chimera: { name: 'Chimera', cls: 'infantry', armor: 'light', hp: 360, spd: 3.0, turn: 4.5, weapon: 'chimerafire', cost: 500, aether: 50, t: 13, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 20, beast: true, desc: 'Lion, goat and serpent in one. Its fire breath reaches up into the sky: the creature that burns flyers down.' },
  phoenix: { name: 'Phoenix', cls: 'air', armor: 'air', hp: 200, spd: 5.0, turn: 4, weapon: 'phoenixfire', cost: 450, aether: 60, t: 12, era: 0, sight: 8, producer: 'air', turret: false, radius: 17, alt: 1.5, beast: true, rebirth: true, desc: 'Firebird. Showers flame on the ground below, and when it falls it bursts alight and rises again from its ashes, once.' },
  dragon: { name: 'Dragon', cls: 'air', armor: 'air', hp: 440, spd: 3.6, turn: 2.8, weapon: 'dragonfire', cost: 800, aether: 90, t: 22, era: 0, sight: 8, producer: 'air', turret: false, radius: 28, alt: 1.9, beast: true, hide: 0.6, desc: 'Great serpent of the sky that guards treasure (Ladon, who coiled round the golden apples). Its breath melts armor and sets whole bases ablaze, and arrows and bullets glance off its scales. Can\'t fight other flyers: send Flak, rockets, a Chimera or a Griffin against it.' },
  unicorn: { name: 'Unicorn', cls: 'infantry', armor: 'light', hp: 280, spd: 4.6, turn: 5, weapon: 'rainbow', cost: 400, aether: 40, t: 12, era: 0, sight: 7, producer: 'infantry', turret: false, radius: 19, beast: true, cleanse: 4, desc: 'A joyful white unicorn with a rainbow mane. Its horn shoots rainbows, and its presence cures every friend nearby of burns, poison, ice, curses, hexes and stone. The answer to spellcasters and the Medusa.' },
};

/** Medics heal this many hit points a second, from up to MEDIC_REACH px away, so they can stay behind the front. */
export const MEDIC_HEAL = 4;
export const MEDIC_REACH = 4 * 32;
/** How close a Worker stands to the unit it patches up, px. */
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

/** Every unit sees this much further than its listed sight (fog of war only; how far it looks for a fight is unchanged). */
export const UNIT_SIGHT_BOOST = 1.3;

export const UNIT_TYPES = Object.keys(UNIT) as UnitType[];

export const isUnitType = (t: string): t is UnitType => t in UNIT;
