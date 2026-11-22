// The top bar (ore, wood, oil, power, age, time) and the selection panel with its commands.
import { G, STANCES, bldDef, isOrganic, unitDef, type Ent, type Stance } from '../../game/state.ts';
import { UNIT, type UnitType } from '../../data/unit.ts';
import { WEAPON } from '../../data/weapon.ts';
import { power } from '../../game/entity.ts';
import { ERA, HEAL_RATE } from '../../data/era.ts';
import { eraOf } from '../../game/production.ts';
import { millRate, oilLeft, oilRate, treesNear, woodRate } from '../../game/economy.ts';
import { OIL_PER_DERRICK } from '../../data/economy.ts';
import { dispatch, ids } from './dispatch.ts';
import { barHtml } from '../../components/bar/bar.ts';
import { chipHtml } from '../../components/chip/chip.ts';
import { hideTooltip, showTooltip } from '../../components/tooltip/tooltip.ts';
import { loadOf } from './render/unit_art.ts';
import { ICON } from './render/icon.ts';
import { commandButtonHtml, type Command } from './components/command_button.ts';
import { COMMAND_KEYS } from './keyboard.ts';
import { V, ownSelected } from './view_state.ts';

export interface HudEls {
  credits: HTMLElement;
  wood: HTMLElement;
  oil: HTMLElement;
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
  if (first.kind === 'bld' && s.length === 1) {
    const list: Command[] = [{ id: 'repair', label: first.repairing ? 'Stop repair' : 'Repair', hotkey: COMMAND_KEYS.repair, icon: ICON.repair, tip: 'Repair this building. Costs ore while it works.', disabled: first.hp >= first.maxhp && !first.repairing }];
    if (first.type !== 'yard') list.push({ id: 'sell', label: 'Sell', hotkey: '', icon: ICON.sell, tip: 'Sell this building for half its value' }); // no hotkey: too easy to hit by accident
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
  else if (id === 'sell' && s[0]) { dispatch({ c: 'sell', id: s[0].id }); V.sel = []; }
  refreshCommands(true);
}

/** Run the command bound to a key, if the current card has one. */
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

function unitDetails(e: Ent): string {
  const d = unitDef(e), enemy = e.team !== V.team ? ' <small class="hud-enemy">enemy</small>' : '';
  const weapon = d.weapon ? `Damage ${WEAPON[d.weapon].dmg} · Range ${WEAPON[d.weapon].range}` : 'Unarmed';
  // organic units heal slowly on their own: show how fast for our own troops
  const heal = isOrganic(e) && e.team === V.team ? ` · Heals ${Math.round(e.maxhp * (HEAL_RATE[G.heal[V.team] ?? 0] ?? 0) * 60)}/min` : '';
  let h = `<h3>${d.name}${enemy}</h3>${barHtml(e.hp / e.maxhp, 'health', 'Health')}<p class="hud-stats">${weapon} · Armor ${d.armor}${heal}</p>`;
  if (e.type === 'harvester') h += `<p class="hud-stats">Ore ${Math.round(e.carry)}</p>${barHtml(loadOf(e.carry), 'progress', 'Ore load')}`;
  return h;
}

const perMin = (perSec: number): number => Math.round(perSec * 60);

function buildingDetails(e: Ent): string {
  const d = bldDef(e), enemy = e.team !== V.team ? ' <small class="hud-enemy">enemy</small>' : '';
  const pw = d.power > 0 ? `Power +${d.power}` : d.power < 0 ? `Power ${d.power}` : '';
  const own = e.team === V.team && e.done;
  const yieldText = !own ? '' : e.type === 'mill' ? `${treesNear(e.tx, e.ty, e.w)} trees · Wood +${perMin(millRate(e))}/min` : e.type === 'derrick' ? (oilLeft(e) > 0 ? `Oil +${perMin(OIL_PER_DERRICK)}/min · ${Math.floor(oilLeft(e))} left` : 'Dry: no oil in reach') : '';
  return `<h3>${d.name}${enemy}</h3>${barHtml(e.hp / e.maxhp, 'health', 'Health')}<p class="hud-stats">${[pw, yieldText, e.repairing ? 'Repairing' : ''].filter(Boolean).join(' · ')}</p>` +
    (e.team === V.team && d.produces && d.produces !== 'structure' ? '<p class="hud-stats">Right-click or tap the ground to set a rally point.</p>' : '');
}

function detailsMarkup(s: Ent[]): string {
  if (s.length > 1)
    return `<h3>${s.length} units</h3><div class="hud-chips">${s.slice(0, 24).map((e, i) => chipHtml({ icon: ICON[e.type], label: UNIT[e.type as UnitType]?.name ?? 'Unit', health: e.hp / e.maxhp, data: ['pick', i] })).join('')}</div>`;
  const e = s[0];
  if (!e) return '<p class="hud-stats">Build power, a lumber mill by the woods, then a refinery. Harvesters bring in ore.</p>';
  if (e.kind === 'unit') return unitDetails(e);
  if (e.kind === 'bld') return buildingDetails(e);
  return '<h3>Ore Crystals</h3><p class="hud-stats">Ore slowly regrows around this rock.</p>';
}

function setTitle(value: HTMLElement, title: string): void {
  const box = value.parentElement;
  if (box && box.title !== title) box.title = title;
}

export function refreshHud(): void {
  const p = power(V.team);
  els.credits.textContent = String(Math.floor(G.credits[V.team]));
  els.wood.textContent = String(Math.floor(G.wood[V.team] ?? 0));
  els.oil.textContent = String(Math.floor(G.oil[V.team] ?? 0));
  setTitle(els.wood, `Wood +${perMin(woodRate(V.team))}/min. Lumber Mills cut it from nearby trees.`);
  setTitle(els.oil, `Oil +${perMin(oilRate(V.team))}/min. Oil Derricks pump it from the World War age on.`);
  els.power.textContent = `${p.used} / ${p.made}`;
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
    showTooltip(els.tooltip, `<b>${c.label}</b>${c.hotkey ? ` [${c.hotkey}]` : ''}<br>${c.tip}`);
  });
  els.commands.addEventListener('mouseleave', () => hideTooltip(els.tooltip));
  // pointerdown, not click: this panel re-renders as health changes
  els.details.addEventListener('pointerdown', (ev) => {
    const p = (ev.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    const u = p && V.sel.filter((x) => !x.dead)[Number(p.dataset.pick)];
    if (u) setSelection([u]);
  });
}
