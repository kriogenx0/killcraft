// The top bar (ore, wood, oil, Aether once found, power, age, time) and the selection panel with its commands.
import { G, STANCES, bldDef, haulOf, isHarvester, isOrganic, unitDef, valid, type Ent, type Stance } from '../../game/state.ts';
import { UNIT, type UnitType } from '../../data/unit.ts';
import { WEAPON, type ArmorClass, type WeaponType } from '../../data/weapon.ts';
import { BUILDING, isUnitProducer, type BldType } from '../../data/building.ts';
import { power } from '../../game/entity.ts';
import { ERA } from '../../data/era.ts';
import { healRate } from '../../game/unit.ts';
import { armorFactor, weaponFactor } from '../../game/upgrade.ts';
import { eraOf, nameOf, priceOf, sitesOf, type Buildable } from '../../game/production.ts';
import { teamColors } from '../../data/team.ts';
import { linesOf } from './hotkeys.ts';
import { dpsOf } from '../../game/dps.ts';
import { priceText } from './components/build_cell.ts';
import { lowPower } from '../../game/entity.ts';
import { millRate, oilLeft, oilRate, treesNear, woodRate, storeMax } from '../../game/economy.ts';
import { OIL_PER_DERRICK } from '../../data/economy.ts';
import { holderOf, waygateLinked } from '../../game/aether.ts';
import { AETHER_RATE, SHRINE_RANGE, WARD_STONE_SIGHT } from '../../data/aether.ts';
import { dispatch, ids } from './dispatch.ts';
import { barHtml } from '../../components/bar/bar.ts';
import { chipHtml } from '../../components/chip/chip.ts';
import { hideTooltip, showTooltip } from '../../components/tooltip/tooltip.ts';
import { ICON } from './render/icon.ts';
import { commandButtonHtml, type Command } from './components/command_button.ts';
import { BUILDING_KEYS, COMMAND_KEYS, keyLabel } from './keyboard.ts';
import { V, ownSelected, spectating } from './view_state.ts';

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
}

let els: HudEls;
let commands: Command[] = [];
let commandMarkup = '';
let detailMarkup = '';

const PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';

const CARGO = { ore: 'Ore', wood: 'Wood', oil: 'Oil' } as const;

export const formatTime = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function setSelection(list: Ent[]): void {
  V.sel = list;
  if (V.mode?.t !== 'place') V.mode = null;
  refreshCommands(true);
}

const STANCE_INFO: Record<Stance, { label: string; tip: string }> = {
  engage: { label: 'Stop & attack', tip: 'Stop to fight enemies met on the way, then carry on (default)' },
  skirmish: { label: 'Move & attack', tip: 'Shoot enemies in range without stopping' },
  passive: { label: 'Don\'t attack', tip: 'Hold fire and run away from enemies' },
};

const isStance = (id: string): id is Stance => (STANCES as readonly string[]).includes(id);

export function commandList(): Command[] {
  if (V.mode) return [{ id: 'cancel', label: 'Cancel', hotkey: 'Esc', icon: ICON.cancel, tip: 'Cancel the current command' }];
  const s = ownSelected();
  const first = s[0];
  if (!first) return [];
  if (first.kind === 'unit')
    return [
      { id: 'move', label: 'Move', hotkey: COMMAND_KEYS.move, icon: ICON.move, tip: 'Move to a location' },
      { id: 'stop', label: 'Stop', hotkey: COMMAND_KEYS.stop, icon: ICON.stop, tip: 'Stop current orders' },
      ...STANCES.map((st): Command => ({ id: st, label: STANCE_INFO[st].label, hotkey: COMMAND_KEYS[st], icon: ICON[st], tip: STANCE_INFO[st].tip, active: s.every((u) => u.stance === st) })),
    ];
  if (first.kind === 'bld' && s.length === 1 && !first.done)
    return [{ id: 'scrap', label: 'Cancel', hotkey: BUILDING_KEYS.scrap, icon: ICON.scrap, tip: 'Stop building this and get its whole price back' }];
  if (first.kind === 'bld' && s.length === 1) {
    const list: Command[] = [{ id: 'repair', label: first.repairing ? 'Stop repair' : 'Repair', hotkey: BUILDING_KEYS.repair, icon: ICON.repair, tip: 'Repair this building. Costs ore while it works.', disabled: first.hp >= first.maxhp && !first.repairing }];
    // Delete, away from the letters, so scrapping is hard to hit by accident
    if (first.type !== 'yard') list.push({ id: 'scrap', label: 'Scrap', hotkey: BUILDING_KEYS.scrap, icon: ICON.scrap, tip: 'Tear this building down. Its scrap is left on the ground as ore for your Workers to carry home' });
    return list;
  }
  return [];
}

export function runCommand(id: string): void {
  const s = ownSelected();
  if (id === 'cancel') V.mode = null;
  else if (id === 'move') V.mode = { t: id };
  else if (isStance(id)) dispatch({ c: 'stance', ids: ids(s.filter((u) => u.kind === 'unit')), stance: id });
  else if (id === 'stop') dispatch({ c: 'stop', ids: ids(s.filter((u) => u.kind === 'unit')) });
  else if (id === 'repair' && s[0]) dispatch({ c: 'repair', id: s[0].id });
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
  const markup = commands.map(commandButtonHtml).join('');
  if (markup !== commandMarkup || force) {
    commandMarkup = markup;
    els.commands.innerHTML = markup;
  }
}

/** Whose it is: "enemy" in your own games; the side's name when spectating. */
function sideTag(e: Ent): string {
  if (spectating()) return e.team < 0 ? '' : ` <small class="hud-side" style="color:${teamColors(e.team).l}">${teamColors(e.team).name}</small>`;
  return e.team !== V.team ? ' <small class="hud-enemy">enemy</small>' : '';
}

/** Full detail (orders, production, rates) is shown for your own things, and for every side when spectating. */
const insight = (e: Ent): boolean => e.team === V.team || spectating();

const entName = (id: number | null): string => {
  const t = id === null ? null : valid(id);
  if (!t) return 'a target';
  return t.kind === 'unit' ? unitDef(t).name : t.kind === 'bld' ? bldDef(t).name : 'ore';
};

const HARVEST_STEP = { go: 'Heading for', gather: 'Gathering', ret: 'Bringing home', unload: 'Unloading' } as const;

/** What a unit is doing right now. */
export function unitAction(e: Ent): string {
  const o = e.order;
  if (e.shot !== null && valid(e.shot)) return `Shooting at ${entName(e.shot)}`;
  if (!o) return 'Idle';
  if (o.t === 'move') return o.sub !== null && valid(o.sub) ? `Fighting ${entName(o.sub)}` : 'Moving';
  if (o.t === 'attack') return `Attacking ${entName(o.tgt)}`;
  if (o.t === 'heal') return `Healing ${entName(o.tgt)}`;
  return `${HARVEST_STEP[o.st]} ${o.res ?? 'ore'}`;
}

/** One row of the stats table: a label, a value, and whether the value needs the full width. */
type Row = [label: string, value: string, wide?: boolean];

/** Label and value pairs, two to a line where they fit, so the panel stays short on phones. */
function tableHtml(rows: Row[]): string {
  return `<dl class="hud-table">${rows.filter((r) => r[1] !== '').map(([l, v, wide]) => `<div class="hud-row${wide ? ' hud-row--wide' : ''}"><dt>${l}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
}

const num = (x: number): string => (Math.abs(x) < 10 ? x.toFixed(1).replace(/\.0$/, '') : String(Math.round(x)));
const hpText = (e: Ent): string => `${Math.ceil(e.hp)} / ${e.maxhp}`;
const costText = (t: string): string => (t in UNIT || t in BUILDING ? priceText(priceOf(t as Buildable)) : '');
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
  // organic units heal slowly on their own: show how fast for troops we can see into
  const heal = isOrganic(e) && insight(e) ? `${Math.round(e.maxhp * healRate(e.team) * 60)}/min` : '';
  const rows: Row[] = [
    ['HP', hpText(e)],
    ['Armor', `${ARMOR_NAME[d.armor]}${ab ? ` −${ab}%` : ''}`],
    ['Damage', w ? `${w.dmg}${wb ? ` +${wb}%` : ''}` : 'Unarmed'],
    ['Range', w ? String(w.range) : ''],
    ['Reload', w ? `${w.cd}s` : ''],
    ['Speed', num(d.spd)],
    ['Turn', `${Math.round((d.turn * 180) / Math.PI)}°/s`],
    ['Sight', String(d.sight)],
    ['Heals', heal],
    ['Cost', costText(e.type)],
  ];
  if (d.weapon) rows.push(['DPS', dpsRow(d.weapon, weaponFactor(e)), true]);
  if (insight(e)) rows.push(['Doing', `${unitAction(e)} · ${STANCE_INFO[e.stance].label}`, true]);
  if (isHarvester(e)) rows.push(['Load', `${CARGO[e.cargo ?? 'ore']} ${Math.round(e.carry)} / ${haulOf(e)}`, true]);
  if (e.loot) rows.push(['Bounty', `${Math.round(e.loot)} ore: bring it near your Construction Yard or a Refinery`, true]);
  if (e.ae) rows.push(['Aether', `${Math.round(e.ae)}: bring it near your Construction Yard or a Refinery`, true]);
  return `<h3>${d.name}${enemy}</h3>${barHtml(e.hp / e.maxhp, 'health', 'Health')}${tableHtml(rows)}`;
}

const perMin = (perSec: number): number => Math.round(perSec * 60);

function buildingDetails(e: Ent): string {
  const d = bldDef(e), enemy = sideTag(e), w = d.weapon ? WEAPON[d.weapon] : null;
  const own = insight(e) && e.done;
  if (!e.done)
    return `<h3>${d.name}${enemy}</h3>${barHtml(e.prog, 'progress', 'Construction')}<p class="hud-stats">Under construction, ${Math.floor(e.prog * 100)}%${insight(e) && lowPower(e.team) ? ' · Half speed: low power' : ''}</p>` +
      barHtml(e.hp / e.maxhp, 'health', 'Health');
  const aetherText = !own ? '' : e.type === 'shrine' ? `Heals your units within ${SHRINE_RANGE} tiles` : e.type === 'wardstone' ? `Reveals cloaked enemies within ${WARD_STONE_SIGHT} tiles`
    : e.type === 'waygate' ? (waygateLinked(e) ? 'Linked: your units step through to the other Waygate' : 'Build a second Waygate to link them') : '';
  const yieldText = aetherText || (!own ? '' : e.type === 'mill' ? `${treesNear(e.tx, e.ty, e.w)} trees · Wood +${perMin(millRate(e))}/min · ${Math.floor(e.carry)}/${storeMax(e)} waiting for Workers` : e.type === 'derrick' ? (oilLeft(e) > 0 ? `Oil +${perMin(OIL_PER_DERRICK)}/min · ${Math.floor(e.carry)}/${storeMax(e)} waiting for Workers · ${Math.floor(oilLeft(e))} left` : 'Dry: no oil in reach') : '');
  // defenses reload 2.5× slower while their side is short of power
  const slow = d.weapon && lowPower(e.team) ? 2.5 : 1;
  const rows: Row[] = [
    ['HP', hpText(e)],
    ['Power', d.power > 0 ? `+${d.power}` : d.power < 0 ? String(d.power) : ''],
    ['Damage', w ? String(w.dmg) : ''],
    ['Range', w ? String(w.range) : ''],
    ['Reload', w ? `${num(w.cd * slow)}s` : ''],
    ['Sight', String(d.sight)],
    ['Cost', costText(e.type)],
    ['Status', !e.done ? 'Building' : e.repairing ? 'Repairing' : ''],
  ];
  if (d.weapon && e.done) rows.push(['DPS', dpsRow(d.weapon, 1, slow) + (slow > 1 ? ' · low power' : ''), true]);
  if (yieldText) rows.push(['Output', yieldText, true]);
  return `<h3>${d.name}${enemy}</h3>${barHtml(e.hp / e.maxhp, 'health', 'Health')}${tableHtml(rows)}` +
    (own ? productionDetails(e) : '') +
    (e.team === V.team && !spectating() && isUnitProducer(d.produces) ? '<p class="hud-stats">Right-click or tap the ground to set a rally point.</p>' : '');
}

/** What a producing building's side is making on its lines (one queue per line, shared by every building of the type). */
export function productionDetails(e: Ent): string {
  const lines = linesOf(e.type as BldType);
  if (!lines.length) return '';
  const queue = lines.flatMap((l) => G.prod[e.team]?.[l] ?? []);
  const n = lines.includes('structure') ? sitesOf(e.team).length : 0;
  const sites = n ? `<p class="hud-stats">${n} structure${n > 1 ? 's' : ''} under construction</p>` : '';
  if (!queue.length) return sites || '<p class="hud-stats">Not producing</p>';
  const head = queue[0], state = head.hold ? 'on hold' : `${Math.round(head.prog * 100)}%`;
  const more = queue.length > 1 ? ` · ${queue.length - 1} more queued` : '';
  return `${sites}<p class="hud-stats">Making ${nameOf(head.type)}, ${state}${more}</p>${barHtml(head.prog, 'progress', 'Production')}`;
}

function detailsMarkup(s: Ent[]): string {
  if (s.length > 1)
    return `<h3>${s.length} units</h3><div class="hud-chips">${s.slice(0, 24).map((e, i) => chipHtml({ icon: ICON[e.type], label: UNIT[e.type as UnitType]?.name ?? 'Unit', health: e.hp / e.maxhp, data: ['pick', i] })).join('')}</div>`;
  const e = s[0];
  if (!e) return '<p class="hud-stats">Build power, a lumber mill by the woods, then a refinery. Harvesters bring in ore.</p>';
  if (e.kind === 'unit') return unitDetails(e);
  if (e.kind === 'bld') return buildingDetails(e);
  if (e.type === 'aether') {
    const h = holderOf(e), held = h < 0 ? '' : h === V.team ? ` · <b>Yours</b>: +${perMin(AETHER_RATE)}/min` : ' · <b>Held by the enemy</b>';
    return `<h3>Aether Deposit</h3>${barHtml(e.hp / e.maxhp, 'progress', 'Aether left')}<p class="hud-stats">${Math.ceil(e.hp)} Aether left${held}</p>` +
      '<p class="hud-stats">Shards of a fallen star. Keep a unit beside it, with no enemy there, to draw Aether. It never regrows.</p>';
  }
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

export function refreshHud(): void {
  const p = power(V.team);
  setText(els.credits, shortCount(G.credits[V.team]));
  setText(els.wood, shortCount(G.wood[V.team] ?? 0));
  setText(els.oil, shortCount(G.oil[V.team] ?? 0));
  const box = els.aether.parentElement, found = !!G.aetherFound[V.team];
  if (box && box.hidden === found) box.hidden = !found;
  if (found) setText(els.aether, shortCount(G.aether[V.team] ?? 0));
  setTitle(els.wood, `Wood +${perMin(woodRate(V.team))}/min. Lumber Mills cut it from nearby trees; Workers carry it home.`);
  setTitle(els.oil, `Oil +${perMin(oilRate(V.team))}/min. Oil Derricks pump it from a well; Workers carry it home.`);
  setText(els.power, `${p.used}/${p.made}`);
  els.power.parentElement?.classList.toggle('ui-resource--warning', p.used > p.made);
  const era = ERA[eraOf(V.team)]?.name ?? '';
  if (els.era.textContent !== era) els.era.textContent = era;
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
  refreshCommands();
}

export function initHud(e: HudEls): void {
  els = e;
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
