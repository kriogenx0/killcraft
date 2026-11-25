// The top bar (ore, wood, oil, Aether once found, power, age, time) and the selection panel with its commands.
import { G, STANCES, allied, hostile, bldDef, loadOf, isHarvester, isOrganic, unitDef, valid, type Ent, type Stance } from '../../game/state.ts';
import { UNIT, isUnitType, type UnitType } from '../../data/unit.ts';
import { WEAPON, type ArmorClass, type WeaponType } from '../../data/weapon.ts';
import { extraHall } from '../../game/building.ts';
import { BUILDING, UPGRADE_BONUS, UPGRADE_HP, isUnitProducer, type BldType } from '../../data/building.ts';
import { power } from '../../game/entity.ts';
import { TEND_RADIUS } from '../../game/unit.ts';
import { GATHER, crewAt, gatherSetting, type GatherRes } from '../../game/autogather.ts';
import { ERA } from '../../data/era.ts';
import { healRate } from '../../game/unit.ts';
import { armorFactor, upgradeOf, weaponFactor } from '../../game/upgrade.ts';
import { armySize, armySlow, available, eraOf, healOf, isFighter, lineOf, nameOf, priceOf, timeText, sitesOf, waitingFor, type Buildable } from '../../game/production.ts';
import { teamColors } from '../../data/team.ts';
import { groupsOf, groupOfType, linesOf, producerOfType } from './hotkeys.ts';
import { dpsOf } from '../../game/dps.ts';
import { priceText } from './components/build_cell.ts';
import { lowPower } from '../../game/entity.ts';
import { oilLeft, oilRate, treesNear, storeMax } from '../../game/economy.ts';
import { OIL_PER_DERRICK, OIL_TRICKLE } from '../../data/economy.ts';
import { holderOf, waygateLinked } from '../../game/aether.ts';
import { AETHER_RATE, SHRINE_RANGE, WARD_STONE_SIGHT } from '../../data/aether.ts';
import { dispatch, ids } from './dispatch.ts';
import { barHtml } from '../../components/bar/bar.ts';
import { chipHtml } from '../../components/chip/chip.ts';
import { hideTooltip, showTooltip } from '../../components/tooltip/tooltip.ts';
import { ICON } from './render/icon.ts';
import { behind, lvlOf, refitBonus, refitPrice, refitTime } from '../../game/refit.ts';
import { commandsHtml, type Command } from './components/command_button.ts';
import { BUILDING_KEYS, COMMAND_KEYS, FOLLOW_KEY, FORMATION_KEY, RALLY_KEY, keyLabel } from './keyboard.ts';
import { followable, followingSelection, toggleFollow } from './follow_cam.ts';
import { V, ownSelected, spectating, toggleFormation } from './view_state.ts';
import { burning, cursed, frozen, lusting, poisoned, sludged, wet } from '../../game/spells.ts';
import { armyShares } from '../../game/army.ts';
import { alive } from '../../game/world.ts';
import { REVIVE_PRICE, canPayRevive, fallenAllies } from '../../game/revive.ts';
import { ELEMENT_DESC, ELEMENT_NAME, SPELL } from '../../data/spells.ts';

export interface HudEls {
  credits: HTMLElement;
  wood: HTMLElement;
  oil: HTMLElement;
  aether: HTMLElement;
  power: HTMLElement;
  era: HTMLElement;
  time: HTMLElement;
  speed: HTMLButtonElement;
  pause: HTMLButtonElement;
  details: HTMLElement;
  commands: HTMLElement;
  tooltip: HTMLElement;
  army: HTMLElement;
  /** the side whose stock is showing, while spectating */
  team: HTMLElement;
}

let els: HudEls;
let commands: Command[] = [];
let commandMarkup = '';
let detailMarkup = '';
let armyMarkup = '';

const PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';

const CARGO = { ore: 'Ore', wood: 'Wood', oil: 'Oil' } as const;

export const formatTime = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function setSelection(list: Ent[]): void {
  V.sel = list;
  V.keyGroup = null;
  if (V.mode?.t !== 'place') V.mode = null;
  refreshCommands(true);
}

const STANCE_INFO: Record<Stance, { label: string; tip: string }> = {
  engage: { label: 'Stop & attack', tip: 'Stop to fight enemies met on the way, then carry on' },
  skirmish: { label: 'Move & attack', tip: 'Shoot enemies in range without stopping (default)' },
  passive: { label: 'Don\'t attack', tip: 'Hold fire and run away from enemies. Workers just keep harvesting' },
  tend: { label: 'Fix, then harvest', tip: `Workers: never attack. When free, build sites, repair buildings and patch up troops within ${TEND_RADIUS} tiles, then go back to harvesting (default)` },
};

/** caption over the stance buttons, which are drawn joined as one pick-one bar */
const STANCE_GROUP = 'Attack mode';

/** the attack-mode bar, default first */
const STANCE_ORDER: Stance[] = ['skirmish', 'engage', 'passive', 'tend'];

const isStance = (id: string): id is Stance => (STANCES as readonly string[]).includes(id);

/** Upgrading a building to its side's age, or cancelling one under way. */
function upgradeCommand(b: Ent): Command | null {
  const next = ERA[lvlOf(b) + 1]?.name;
  if (!next || !(behind(b) || b.upT != null)) return null;
  if (b.upT != null) return { id: 'upgrade', label: 'Cancel upgrade', hotkey: BUILDING_KEYS.upgrade, icon: ICON.cancel, tip: `Stop upgrading to the ${next} age and get the full price back` };
  const p = refitPrice(b), pct = Math.round(UPGRADE_BONUS * 100), hp = Math.round(UPGRADE_HP * 100);
  return {
    id: 'upgrade', label: 'Upgrade', hotkey: BUILDING_KEYS.upgrade, icon: ICON.upgrade, cost: { g: p.ore, w: p.wood },
    tip: `Rebuild in the ${next} style (${Math.round(refitTime(b))}s): +${hp}% health and +${pct}% to what it does`,
    disabled: G.credits[V.team] < p.ore || G.wood[V.team] < p.wood,
  };
}

/** Follow (or stop following) a selected unit with the camera. */
function followCommand(): Command | null {
  if (!followable()) return null;
  const on = followingSelection();
  return { id: 'follow', label: on ? 'Following' : 'Follow', hotkey: FOLLOW_KEY, icon: ICON.follow, active: on, tip: on ? 'Stop following this unit (panning the map stops it too)' : 'Keep the camera on this unit as it moves. Pan the map to let go' };
}

/** Keep formation: a group of units moves together, at its slowest unit's pace, and keeps its shape. */
function formationCommand(): Command {
  const on = V.formation;
  return { id: 'formation', label: 'Formation', hotkey: FORMATION_KEY, icon: ICON.formation, active: on, tip: on ? 'On: groups move together at the slowest unit\'s pace and keep their shape. Turn off to let everyone go at full speed' : 'Move groups in formation: together at the slowest unit\'s pace, keeping their shape, so they arrive at once' };
}

/** Rally the army: every fighter heads to one spot, and new troops from every producer follow. */
function rallyCommand(): Command | null {
  if (spectating() || G.over) return null;
  return { id: 'rally', label: 'Rally army', hotkey: RALLY_KEY, icon: ICON.rally, tip: 'Pick a spot: your whole army heads there now, and new troops from every Barracks, Factory and Airfield follow. Workers keep working' };
}

const GATHER_INFO: Record<GatherRes, { label: string; tip: string }> = {
  auto: { label: 'Auto', tip: 'Gather whatever you have least of, switching as that changes' },
  ore: { label: 'Ore', tip: 'Dig ore: the ore nearest your base first' },
  wood: { label: 'Wood', tip: 'Chop wood: the trees nearest a drop-off first' },
  oil: { label: 'Oil', tip: 'Haul oil from your Oil Derrick nearest the base' },
  aether: { label: 'Aether', tip: 'Draw Aether at the deposit nearest your base, bank it, and go back for more' },
};

/** The Workers' gather setting: Auto, or one resource they stay on (Aether on its own button). */
function gatherCommands(s: Ent[]): Command[] {
  const ws = s.filter((u) => u.type === 'worker');
  const can: Record<GatherRes, boolean> = {
    auto: true,
    ore: true,
    wood: true,
    oil: G.ents.some((d) => !d.dead && d.team === V.team && d.type === 'derrick' && d.done),
    aether: G.ents.some((d) => !d.dead && d.type === 'aether'),
  };
  return GATHER.map((r) => {
    const id = `gather:${r}` as const;
    return { id, label: GATHER_INFO[r].label, hotkey: COMMAND_KEYS[id], icon: ICON[id], tip: can[r] ? GATHER_INFO[r].tip : r === 'oil' ? 'Build an Oil Derrick on an oil well first' : 'No Aether left on the map', group: r === 'aether' ? undefined : 'Gather', disabled: !can[r], active: ws.every((u) => gatherSetting(u) === r) };
  });
}

/** A phone or tablet: touch is the main way in, so there's no keyboard for hotkey groups. */
const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function commandList(): Command[] {
  if (V.mode) return [{ id: 'cancel', label: 'Cancel', hotkey: 'Esc', icon: ICON.cancel, tip: V.mode.t === 'rally' ? 'Click or tap the ground to rally your army there' : 'Cancel the current command' }];
  const s = ownSelected();
  const first = s[0];
  const follow = followCommand(), rally = rallyCommand();
  // nothing of yours selected: enemy units you can see, and anything while spectating, can be followed
  // (Rally army stays on your units' and buildings' buttons, Shift+R and the touch bar, not here)
  if (!first) return follow ? [follow] : [];
  if (V.keyGroup) return [{ id: 'back', label: 'Back', hotkey: 'Escape', icon: ICON.cancel, tip: `Close ${V.keyGroup}` }];
  if (first.kind === 'unit')
    return [
      { id: 'move', label: 'Move', hotkey: COMMAND_KEYS.move, icon: ICON.move, tip: 'Move to a location' },
      ...(s.some((u) => u.kind === 'unit' && (unitDef(u).weapon || u.type === 'medic')) ? [{ id: 'patrol', label: 'Patrol', hotkey: COMMAND_KEYS.patrol, icon: ICON.patrol, tip: 'Walk back and forth between here and a point, fighting by stance on the way (Medics heal the wounded they pass)' }] : []),
      { id: 'stop', label: 'Stop', hotkey: COMMAND_KEYS.stop, icon: ICON.stop, tip: 'Stop current orders' },
      // Fix, then harvest is for Workers only (and is theirs by default)
      ...STANCE_ORDER.filter((st) => st !== 'tend' || s.some((u) => u.type === 'worker'))
        .map((st): Command => ({ id: st, label: STANCE_INFO[st].label, hotkey: COMMAND_KEYS[st], icon: ICON[st], tip: STANCE_INFO[st].tip, group: STANCE_GROUP, active: s.filter((u) => st !== 'tend' || u.type === 'worker').every((u) => u.stance === st) })),
      ...(s.filter((u) => u.kind === 'unit').length > 1 ? [formationCommand()] : []),
      ...(s.some((u) => u.type === 'worker') ? gatherCommands(s) : []),
      ...(follow ? [follow] : []),
      ...(rally && s.some((u) => u.kind === 'unit' && !isHarvester(u)) ? [rally] : []),
    ];
  if (first.kind === 'bld' && s.length === 1 && !first.done)
    return [{ id: 'scrap', label: 'Cancel', hotkey: BUILDING_KEYS.scrap, icon: ICON.scrap, tip: 'Stop building this and get its whole price back' }];
  if (first.kind === 'bld' && s.length === 1) {
    const list: Command[] = [{ id: 'repair', label: first.repairing ? 'Stop repair' : 'Repair', hotkey: BUILDING_KEYS.repair, icon: ICON.repair, tip: 'Repair this building. Costs ore while it works.', disabled: first.hp >= first.maxhp && !first.repairing }];
    const up = upgradeCommand(first);
    if (up) list.push(up);
    if (first.type === 'derrick' && first.done) {
      const n = crewAt(first);
      list.push({ id: 'recruit', label: 'Send Worker', hotkey: '', icon: ICON.worker, disabled: !G.ents.some((u) => !u.dead && u.team === V.team && u.type === 'worker'),
        tip: `Send your nearest free Worker to carry oil from this Derrick's tank (${n} on it now)` });
    }
    // team games: a Town Hall can give a teammate who has lost theirs a new one
    if (first.type === 'yard' && first.done && !G.over) for (const t of fallenAllies(V.team)) {
      const who = teamColors(t).name;
      list.push({
        id: `revive:${t}`, label: `Revive ${who}`, hotkey: '', icon: ICON.yard ?? ICON.upgrade, cost: { g: REVIVE_PRICE.ore, w: REVIVE_PRICE.wood },
        tip: `${who} has no Town Hall. Give them a new one and two Workers, back at their corner, so they can rebuild and fight again`,
        disabled: !canPayRevive(V.team),
      });
    }
    const rally = rallyCommand();
    if (rally && first.done && isUnitProducer(bldDef(first).produces)) list.push(rally);
    // Delete, away from the letters, so scrapping is hard to hit by accident
    // sub-menus of production hotkeys, such as the yard's walls and defenses: keyboard helpers, so not on phones and tablets
    for (const [g, key] of first.done && !coarsePointer() ? groupsOf(first.type as BldType) : []) {
      const icon = Object.keys(ICON).find((t) => groupOfType(t) === g && producerOfType(t as Buildable) === first.type);
      // hide a group with nothing in it yet, such as Aether before any is found
      if (!icon || !available(V.team, lineOf(icon as Buildable)).some((t) => groupOfType(t) === g)) continue;
      list.push({ id: `group:${g}`, label: g, hotkey: key, icon: ICON[icon], tip: `${g}: press ${key}, then the letter shown on one in the sidebar` });
    }
    if (first.type !== 'yard' || extraHall(first)) list.push({ id: 'scrap', label: 'Scrap', hotkey: BUILDING_KEYS.scrap, icon: ICON.scrap, tip: 'Tear this building down. Its scrap is left on the ground as ore for your Workers to carry home' });
    return list;
  }
  return [];
}

export function runCommand(id: string): void {
  const s = ownSelected();
  if (id === 'cancel') V.mode = null;
  else if (id === 'back') V.keyGroup = null;
  else if (id.startsWith('group:')) V.keyGroup = id.slice(6);
  else if (id === 'follow') toggleFollow();
  else if (id === 'formation') toggleFormation();
  else if (id === 'move' || id === 'patrol' || id === 'rally') V.mode = { t: id };
  else if (id.startsWith('gather:')) dispatch({ c: 'gather', ids: ids(s.filter((u) => u.type === 'worker')), res: id.slice(7) as GatherRes });
  else if (isStance(id)) dispatch({ c: 'stance', ids: ids(s.filter((u) => u.kind === 'unit')), stance: id });
  else if (id === 'stop') dispatch({ c: 'stop', ids: ids(s.filter((u) => u.kind === 'unit')) });
  else if (id === 'repair' && s[0]) dispatch({ c: 'repair', id: s[0].id });
  else if (id === 'recruit' && s[0]) dispatch({ c: 'recruit', id: s[0].id });
  else if (id === 'upgrade' && s[0]) dispatch({ c: 'upgrade', id: s[0].id });
  else if (id.startsWith('revive:')) dispatch({ c: 'revive', team: Number(id.slice(7)) });
  else if (id === 'scrap' && s[0]) { dispatch({ c: 'scrap', id: s[0].id }); V.sel = []; }
  refreshCommands(true);
}

/** Run the command bound to a key (lower case, see normalizeKey), if the current card has one. */
export function runHotkey(key: string): boolean {
  const c = commandList().find((x) => x.hotkey && x.hotkey.toLowerCase() === key && !x.disabled);
  if (c) runCommand(c.id);
  return !!c;
}

export function refreshCommands(force = false): void {
  commands = commandList();
  const markup = commandsHtml(commands);
  if (markup !== commandMarkup || force) {
    commandMarkup = markup;
    els.commands.innerHTML = markup;
  }
}

/** Whose it is: "enemy" in your own games; the side's name when spectating. */
function sideTag(e: Ent): string {
  if (spectating()) return e.team < 0 ? '' : ` <small class="hud-side" style="color:${teamColors(e.team).l}">${teamColors(e.team).name}</small>`;
  return hostile(e.team, V.team) ? ' <small class="hud-enemy">enemy</small>' : e.team !== V.team && allied(e.team, V.team) ? ` <small class="hud-ally" style="color:${teamColors(e.team).l}">ally</small>` : '';
}

/** Full detail (orders, production, rates) is shown for your own things, and for every side when spectating. */
const insight = (e: Ent): boolean => e.team === V.team || spectating();

const entName = (id: number | null): string => {
  const t = id === null ? null : valid(id);
  if (!t) return 'a target';
  return t.kind === 'unit' ? unitDef(t).name : t.kind === 'bld' ? bldDef(t).name : 'ore';
};

/** Workers on a wood run (for one mill, if given). */
const choppers = (team: number, mill?: number): number =>
  G.ents.filter((e) => !e.dead && e.team === team && e.order?.t === 'harvest' && e.order.res === 'wood' && (mill === undefined || e.order.src === mill)).length;

const HARVEST_STEP = { go: 'Heading for', gather: 'Gathering', ret: 'Bringing home', unload: 'Unloading' } as const;

/** What a unit is doing right now. */
export function unitAction(e: Ent): string {
  const o = e.order;
  if (e.shot !== null && valid(e.shot)) return `Shooting at ${entName(e.shot)}`;
  if (!o) return 'Idle';
  if (o.t === 'move') return o.sub !== null && valid(o.sub) ? `Fighting ${entName(o.sub)}` : 'Moving';
  if (o.t === 'attack') return `Attacking ${entName(o.tgt)}`;
  if (o.t === 'heal') return `Healing ${entName(o.tgt)}`;
  if (o.res === 'wood' && o.st === 'gather') return 'Chopping wood';
  // on the way home it's what it carries that counts, which may not be what it's off to gather next
  const what = o.st === 'ret' || o.st === 'unload' ? e.cargo ?? 'ore' : o.res ?? 'ore';
  return `${HARVEST_STEP[o.st]} ${what}`;
}

/** An upgrade level after a stat, e.g. " · Lvl 2" (nothing before the first upgrade). */
const lvlTag = (n: number): string => (n > 0 ? ` <span class="hud-lvl">Lvl ${n}</span>` : '');

/** One row of the stats table: a label, a value, and whether the value needs the full width. */
type Row = [label: string, value: string, wide?: boolean];

/** Label and value pairs, two to a line where they fit, so the panel stays short on phones. */
function tableHtml(rows: Row[]): string {
  return `<dl class="hud-table">${rows.filter((r) => r[1] !== '').map(([l, v, wide]) => `<div class="hud-row${wide ? ' hud-row--wide' : ''}"><dt>${l}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

const num = (x: number): string => (Math.abs(x) < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));
const hpText = (e: Ent): string => `${Math.ceil(e.hp)} / ${e.maxhp}`;
/** price and how long it takes to make, e.g. "100 ore · 20 wood · Train 3s" (demons and hatched units aren't trained) */
const costText = (t: string): string => {
  if (!(t in UNIT || t in BUILDING)) return '';
  const u = t in UNIT ? UNIT[t as UnitType] : undefined;
  return priceText(priceOf(t as Buildable)) + (u?.demon || u?.hatched ? '' : ` · ${timeText(t as Buildable)}`);
};
const ARMOR_NAME: Record<ArmorClass, string> = { none: 'None', light: 'Light', heavy: 'Heavy', building: 'Building', air: 'Air' };
const DPS_SHORT: Record<ArmorClass, string> = { none: 'Inf', light: 'Light', heavy: 'Heavy', building: 'Bldg', air: 'Air' };

/** Damage per second against each kind of target it can hit, e.g. "Inf 10 · Light 5 · Bldg 2.5". */
function dpsRow(wt: WeaponType, bonus: number, slow = 1): string {
  return dpsOf(wt, bonus, slow).map((d) => `${DPS_SHORT[d.armor]} <b>${num(d.dps)}</b>`).join(' · ') + (WEAPON[wt].splash > 0 ? ' · splash' : '');
}

function unitDetails(e: Ent): string {
  const d = unitDef(e), enemy = sideTag(e), w = d.weapon ? WEAPON[d.weapon] : null;
  // Armory upgrades show as percentages next to the base numbers
  const wb = Math.round((weaponFactor(e) - 1) * 100), ab = Math.round((1 - armorFactor(e)) * 100);
  const s = d.cls === 'infantry' ? 'inf' : 'veh', wl = upgradeOf(e.team, `${s}Weapon`), al = upgradeOf(e.team, `${s}Armor`), hl = healOf(e.team);
  // organic units heal slowly on their own: show how fast for troops we can see into
  const heal = isOrganic(e) && insight(e) ? `${Math.round(e.maxhp * healRate(e.team) * 60)}/min${lvlTag(hl)}` : '';
  const rows: Row[] = [
    ['HP', hpText(e)],
    ['Armor', `${ARMOR_NAME[d.armor]}${ab ? ` −${ab}%` : ''}${lvlTag(al)}`],
    ['Damage', w ? `${w.dmg}${wb ? ` +${wb}%` : ''}${lvlTag(wl)}` : 'Unarmed'],
    ['Range', w ? String(w.range) : ''],
    ['Reload', w ? `${w.cd}s` : ''],
    ['Speed', num(d.spd)],
    ['Turn', `${Math.round((d.turn * 180) / Math.PI)}°/s`],
    ['Heals', heal],
    ['Cost', costText(e.type)],
  ];
  if (d.weapon) rows.push(['DPS', dpsRow(d.weapon, weaponFactor(e)), true]);
  if (insight(e)) rows.push(['Doing', `${unitAction(e)} · ${STANCE_INFO[e.stance].label}`, true]);
  if (isHarvester(e)) rows.push(['Load', `${CARGO[e.cargo ?? 'ore']} ${Math.round(e.carry)} / ${loadOf(e)}`, true]);
  if (e.loot) rows.push(['Bounty', `${Math.round(e.loot)} ore: bring it near your Town Hall or a Refinery`, true]);
  if (d.weapon && WEAPON[d.weapon].element) { const el = WEAPON[d.weapon].element!; rows.push(['Element', `${ELEMENT_NAME[el]}: ${ELEMENT_DESC[el]}`, true]); }
  if (d.spells?.length) {
    if (insight(e)) rows.push(['Mana', `${Math.floor(e.mana ?? 0)} / ${d.mana}`]);
    rows.push(['Spells', d.spells.map((s) => `<b>${SPELL[s].name}</b> (${SPELL[s].mana}): ${SPELL[s].desc}`).join('<br>'), true]);
  }
  const fx = effectsOf(e);
  if (fx) rows.push(['Effects', fx, true]);
  if (e.ae) rows.push(['Aether', `${Math.round(e.ae)}: bring it near your Town Hall or a Refinery`, true]);
  return `<h3>${d.name}${enemy}</h3>${descHtml(d.desc)}${barHtml(e.hp / e.maxhp, 'health', 'Health')}${tableHtml(rows)}`;
}

/** The spells and elements on a unit right now, e.g. "Burning · Wet". */
function effectsOf(e: Ent): string {
  const on: [boolean, string][] = [[frozen(e), 'Frozen'], [burning(e), 'Burning'], [poisoned(e), 'Poisoned'], [lusting(e), 'Bloodlust'], [cursed(e), 'Slowed'], [sludged(e), 'Sludged'], [wet(e), 'Wet']];
  return on.filter(([b]) => b).map(([, n]) => n).join(' · ');
}

/** What it does in game, in a sentence or two, under the selected thing's name. */
const descHtml = (desc: string): string => (desc ? `<p class="hud-desc">${desc}</p>` : '');

const perMin = (perSec: number): number => Math.round(perSec * 60);

function buildingDetails(e: Ent): string {
  const d = bldDef(e), enemy = sideTag(e), w = d.weapon ? WEAPON[d.weapon] : null;
  const own = insight(e) && e.done;
  if (!e.done)
    return `<h3>${d.name}${enemy}</h3>${descHtml(d.desc)}${barHtml(e.prog, 'progress', 'Construction')}<p class="hud-stats">${e.unpaid && insight(e) ? `Waiting for ${waitingFor(e.team, e.type as BldType) ?? 'funds'} to start building` : `Under construction, ${Math.floor(e.prog * 100)}%`}${insight(e) && lowPower(e.team) ? ' · Half speed: low power' : ''}</p>` +
      barHtml(e.hp / e.maxhp, 'health', 'Health');
  const aetherText = !own ? '' : e.type === 'shrine' ? `Heals your units within ${SHRINE_RANGE} tiles` : e.type === 'wardstone' ? `Reveals cloaked enemies within ${WARD_STONE_SIGHT} tiles`
    : e.type === 'waygate' ? (waygateLinked(e) ? 'Linked: your units step through to the other Waygate' : 'Build a second Waygate to link them') : '';
  const yieldText = aetherText || (!own ? '' : e.type === 'camp' ? 'Workers and Harvesters drop ore and oil here' : e.type === 'mill' ? `${treesNear(e.tx, e.ty, e.w)} trees nearby · ${choppers(V.team, e.id)} Workers chopping here · Workers drop wood here` : e.type === 'derrick' ? `${Math.floor(e.carry)}/${storeMax(e)} in the tank for Workers · ${oilLeft(e) > 0 ? `pumps +${perMin(OIL_PER_DERRICK)}/min · ${Math.floor(oilLeft(e))} left in the well` : `well dry: trickles +${perMin(OIL_TRICKLE)}/min`}` : '');
  // defenses reload 2.5× slower while their side is short of power
  const slow = d.weapon && lowPower(e.team) ? 2.5 : 1;
  const rows: Row[] = [
    ['HP', hpText(e)],
    ['Age', ERA[lvlOf(e)]?.name + (lvlOf(e) > 0 ? ` · +${Math.round((refitBonus(e) - 1) * 100)}% output` : '')],
    ['Power', d.power > 0 ? `+${Math.round(d.power * refitBonus(e))}` : d.power < 0 ? String(d.power) : ''],
    ['Damage', w ? String(num(w.dmg * refitBonus(e))) : ''],
    ['Range', w ? String(w.range) : ''],
    ['Reload', w ? `${num(w.cd * slow)}s` : ''],
    ['Cost', costText(e.type)],
    ['Status', !e.done ? 'Building' : e.upT != null ? `Upgrading to ${ERA[lvlOf(e) + 1]?.name} · ${Math.floor(e.upT * 100)}%` : e.repairing ? 'Repairing' : ''],
  ];
  if (d.weapon && e.done) rows.push(['DPS', dpsRow(d.weapon, refitBonus(e), slow) + (slow > 1 ? ' · low power' : ''), true]);
  if (yieldText) rows.push(['Output', yieldText, true]);
  // the levels this side has researched here
  if (own && e.type === 'armory') {
    const lv = (t: 'infWeapon' | 'infArmor' | 'vehWeapon' | 'vehArmor') => `Lvl ${upgradeOf(e.team, t)}`;
    rows.push(['Troops', `Weapons ${lv('infWeapon')} · Armor ${lv('infArmor')}`, true], ['Machines', `Weapons ${lv('vehWeapon')} · Armor ${lv('vehArmor')}`, true]);
  }
  if (own && e.type === 'hospital') rows.push(['Healing', `Lvl ${healOf(e.team)}`]);
  return `<h3>${d.name}${enemy}</h3>${descHtml(d.desc)}${barHtml(e.hp / e.maxhp, 'health', 'Health')}${tableHtml(rows)}` +
    (own ? productionDetails(e) : '') +
    (e.team === V.team && !spectating() && isUnitProducer(d.produces) ? '<p class="hud-stats">Right-click or tap the ground to set this building\'s rally point. Rally army sets one for every building.</p>' : '');
}

/** What a producing building is making (each Barracks trains its own order; the queue is shared by every building of the type). */
export function productionDetails(e: Ent): string {
  const lines = linesOf(e.type as BldType);
  if (!lines.length) return '';
  const queue = lines.flatMap((l) => G.prod[e.team]?.[l] ?? []);
  const n = lines.includes('structure') ? sitesOf(e.team).length : 0;
  const sites = n ? `<p class="hud-stats">${n} structure${n > 1 ? 's' : ''} under construction</p>` : '';
  if (!queue.length) return sites || '<p class="hud-stats">Not producing</p>';
  // this building's own order, else the next one waiting (on hold, or for funds)
  const head = queue.find((it) => it.at === e.id) ?? queue.find((it) => it.at == null);
  const others = queue.filter((it) => it !== head && it.at != null).length, waiting = queue.filter((it) => it !== head && it.at == null).length;
  if (!head) return `${sites}<p class="hud-stats">Free · ${others} training in other buildings</p>`;
  const need = !head.paid && waitingFor(e.team, head.type);
  const state = head.hold ? 'on hold' : need ? `waiting for ${need}` : `${Math.round(head.prog * 100)}%`;
  const more = [others ? `${others} in other buildings` : '', waiting ? `${waiting} more queued` : ''].filter(Boolean).map((t) => ` · ${t}`).join('');
  // a big army trains slower (ARMY_SLOW_FROM)
  const size = armySize(e.team), slow = isUnitType(head.type) && isFighter(head.type) ? armySlow(e.team, size) : 1;
  const slowNote = slow > 1 ? `<p class="hud-stats hud-warn">Army of ${size}: new troops take ${Math.round((slow - 1) * 100)}% longer</p>` : '';
  return `${sites}<p class="hud-stats">Making ${nameOf(head.type)}, ${state}${more}</p>${barHtml(head.prog, 'progress', 'Production')}${slowNote}`;
}

function detailsMarkup(s: Ent[]): string {
  if (s.length > 1)
    return `<h3>${s.length} units</h3><div class="hud-chips">${s.slice(0, 24).map((e, i) => chipHtml({ icon: ICON[e.type], label: UNIT[e.type as UnitType]?.name ?? 'Unit', health: e.hp / e.maxhp, data: ['pick', i] })).join('')}</div>`;
  const e = s[0];
  if (!e) return '';
  if (e.kind === 'unit') return unitDetails(e);
  if (e.kind === 'bld') return buildingDetails(e);
  if (e.type === 'aether') {
    const h = holderOf(e), held = h < 0 ? '' : h === V.team ? ` · <b>Yours</b>: +${perMin(AETHER_RATE)}/min` : ' · <b>Held by the enemy</b>';
    return `<h3>Aether Deposit</h3>${barHtml(e.hp / e.maxhp, 'progress', 'Aether left')}<p class="hud-stats">${Math.ceil(e.hp)} Aether left${held}</p>` +
      '<p class="hud-stats">Shards of a fallen star. Keep a unit beside it, with no enemy there, to draw Aether. It never regrows.</p>';
  }
  if (e.type === 'shard') return `<h3>Dropped Aether</h3><p class="hud-stats">${Math.ceil(e.hp)} Aether, fallen with the unit that carried it. Any unit that walks over it picks it up. Workers that see it fetch it and take it home: idle ones nearby, and gathering ones on their way back out, unless an enemy soldier is guarding it.</p>`;
  return '<h3>Ore Crystals</h3><p class="hud-stats">Ore slowly regrows around this rock.</p>';
}

function setTitle(value: HTMLElement, title: string): void {
  const box = value.parentElement;
  if (box && box.title !== title) box.title = title;
}

/** A stock count in at most four characters, so the top bar's slots never overflow: 9999, then 12k. */
export function shortCount(n: number): string {
  const v = Math.floor(n);
  return v < 10000 ? String(v) : `${Math.min(999, Math.floor(v / 1000))}k`;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Too thin a slice to fit its number: the number shows on hover instead. */
const LABEL_MIN = 0.07;

/**
 * Once you are beaten, or while watching, a bar under the top bar: each side's share of all the
 * armies on the map, by what the units cost, in that side's color.
 */
function refreshArmyBar(): void {
  const show = V.started && (spectating() || !alive(V.team));
  const shares = show ? armyShares() : [];
  const markup = shares.map(({ team, share }) => {
    const c = teamColors(team), pct = `${Math.round(share * 100)}%`;
    return `<span class="army-bar-seg" style="flex-grow:${share.toFixed(3)};background:${c.m}" title="${c.name}: ${pct} of the armies">${share >= LABEL_MIN ? pct : ''}</span>`;
  }).join('');
  if (markup === armyMarkup) return;
  armyMarkup = markup;
  els.army.innerHTML = markup;
  els.army.hidden = !markup;
  els.army.setAttribute('aria-label', `Share of the armies: ${shares.map(({ team, share }) => `${teamColors(team).name} ${Math.round(share * 100)}%`).join(', ')}`);
}

/**
 * Whose stock the top bar shows: your own; while spectating, the side of whatever is selected, or
 * nobody (-1) until something is.
 */
export function hudTeam(): number {
  if (!spectating()) return V.team;
  return V.sel.find((e) => !e.dead && e.team >= 0 && e.team < G.teams)?.team ?? -1;
}

let resourceBoxes: HTMLElement[] = [];

export function refreshHud(): void {
  const team = hudTeam(), none = team < 0;
  for (const box of resourceBoxes) box.classList.toggle('topbar-off', none);
  const tag = spectating() && !none ? teamColors(team) : null, tagText = tag?.name ?? '';
  if (els.team.hidden === !!tag) els.team.hidden = !tag;
  if (tag && els.team.textContent !== tagText) { els.team.textContent = tagText; els.team.style.color = tag.l; els.team.style.background = tag.d; }
  if (!none) {
    const p = power(team);
    setText(els.credits, shortCount(G.credits[team]));
    setText(els.wood, shortCount(G.wood[team] ?? 0));
    setText(els.oil, shortCount(G.oil[team] ?? 0));
    const box = els.aether.parentElement, found = !!G.aetherFound[team];
    if (box && box.hidden === found) box.hidden = !found;
    if (found) setText(els.aether, shortCount(G.aether[team] ?? 0));
    setTitle(els.wood, `Wood. ${choppers(team)} Workers chopping. Right-click a tree with Workers: they chop it and carry the wood to a Lumber Mill, Refinery or the Town Hall.`);
    setTitle(els.oil, `Oil +${perMin(oilRate(team))}/min. Oil Derricks pump it from a well; Workers carry it home.`);
    setText(els.power, `${p.used}/${p.made}`);
    els.power.parentElement?.classList.toggle('ui-resource--warning', p.used > p.made);
    const era = ERA[eraOf(team)]?.name ?? '';
    if (els.era.textContent !== era) els.era.textContent = era;
  }
  els.time.textContent = formatTime(G.gameT);
  const speed = `${V.speed}x`;
  if (els.speed.textContent !== speed) els.speed.textContent = speed;
  const pause = V.paused ? PLAY_ICON : PAUSE_ICON;
  if (els.pause.innerHTML !== pause) {
    els.pause.innerHTML = pause;
    els.pause.setAttribute('aria-label', V.paused ? 'Resume' : 'Pause');
  }
  const markup = detailsMarkup(V.sel.filter((e) => !e.dead));
  if (markup !== detailMarkup) {
    detailMarkup = markup;
    els.details.innerHTML = markup;
  }
  refreshArmyBar();
  refreshCommands();
  // nothing selected and no commands: the selection pane takes no room at all
  const pane = els.details.parentElement, empty = !detailMarkup && !commandMarkup;
  if (pane && pane.hidden !== empty) pane.hidden = empty;
}

export function initHud(e: HudEls): void {
  els = e;
  resourceBoxes = [e.credits, e.wood, e.oil, e.aether, e.power, e.era].map((v) => v.parentElement).filter((b): b is HTMLElement => !!b);
  els.commands.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    const c = b && commands[Number(b.dataset.index)];
    if (c && !b.disabled) runCommand(c.id);
  });
  els.commands.addEventListener('mouseover', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button');
    const c = b && commands[Number(b.dataset.index)];
    if (!c) { hideTooltip(els.tooltip); return; }
    showTooltip(els.tooltip, `<b>${c.label}</b>${c.hotkey ? ` <kbd class="ui-key">${keyLabel(c.hotkey)}</kbd>` : ''}<br>${c.tip}`);
  });
  els.commands.addEventListener('mouseleave', () => hideTooltip(els.tooltip));
  // pointerdown, not click: this panel re-renders as health changes
  els.details.addEventListener('pointerdown', (ev) => {
    const p = (ev.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    const u = p && V.sel.filter((x) => !x.dead)[Number(p.dataset.pick)];
    if (u) setSelection([u]);
  });
}
