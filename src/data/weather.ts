// Weather (Alex, 2026-11-27: "occasional rain and sometimes a meteor shower or hail; does damage to a
// large area and moves across the map"). Rain passes now and then and is only for show, apart from
// putting fires out. Rarely, a storm forms at the edge of the map and sweeps across it: a hailstorm
// pelts everything under it, a meteor shower rains burning stones on the ground below. Both are slow
// enough to walk out of, and show on the minimap and the ground before they bite. The computer moves
// its troops out of the way; buildings just have to take it.
// Times are seconds, distances tiles.

/** Seconds until the first rain, then between showers, and how long a shower lasts (each at random within the range). */
export const RAIN_FIRST: [number, number] = [90, 240];
export const RAIN_GAP: [number, number] = [180, 360];
export const RAIN_LEN: [number, number] = [50, 110];
/** How fast rain comes on and eases off (intensity per second, 0..1). */
export const RAIN_FADE = 0.12;
/** Rain at least this heavy puts out burning units. */
export const RAIN_DOUSE = 0.5;

/** Seconds until the first storm, then between storms. Storms are rare: a long game sees two or three. */
export const STORM_FIRST: [number, number] = [420, 600];
export const STORM_GAP: [number, number] = [360, 540];
/** Share of storms that are meteor showers (the rest are hail). */
export const METEOR_SHARE = 0.45;
/** Seconds a new storm spends gathering at the edge of the map before it does any harm. */
export const STORM_FORM = 10;
/** Storm radius (tiles) and speed (tiles per second): about 10 s to pass over one spot, and slower than any unit. */
export const STORM_RADIUS: Record<StormKind, number> = { hail: 7, meteor: 6 };
export const STORM_SPEED = 1.1;
/** A storm aims at a point this far (tiles) from the middle of the map, so most cross the middle ground but none quite the same way. */
export const STORM_AIM = 18;

export type StormKind = 'hail' | 'meteor';

/** Hail: damage per second to whatever stands under it, by kind (before Armory armour). */
export const HAIL_DPS = { infantry: 6, vehicle: 3, air: 6, building: 3 };
/** Seconds between hail ticks. */
export const HAIL_TICK = 0.5;

/** Meteor shower: stones per second that fall somewhere under it, and each one's blast. */
export const METEOR_RATE = 2;
export const METEOR_DMG = 60;
/** blast radius, px */
export const METEOR_SPLASH = 38;
/** damage by armour (aircraft fly over the falling stones) */
export const METEOR_VS = { none: 1, light: 1, heavy: 0.8, building: 1.2, air: 0 };
/** Seconds a stone takes to fall. */
export const METEOR_FALL = 1.1;

/** The computer moves its units out when a storm is this close (tiles beyond its edge), or will be within DODGE_AHEAD seconds. */
export const DODGE_MARGIN = 2;
export const DODGE_AHEAD = 5;
/** How far beyond a storm's edge (tiles) a dodging unit heads. */
export const DODGE_CLEAR = 3;
