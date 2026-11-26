// The production sidebar: Buildings and Units tabs, each a list of items. Cells are created when the
// available list changes and updated in place every frame, so clicks are never lost.
import { G } from '../../game/state.ts';
import { UNIT, isUnitType } from '../../data/unit.ts';
import { dpsText, teamWeaponBonus } from '../../game/dps.ts';
import { BUILDING, type BldType } from '../../data/building.ts';
import { atLimit, available, unitNeeds, unitSlots, canAfford, priceOf, descOf, timeText, itemsOf, lineOf, nameOf, sitesOf, waitingFor, type Buildable } from '../../game/production.ts';
import { dispatch } from './dispatch.ts';
import { buildCellHtml } from './components/build_cell.ts';
import { ICON } from './render/icon.ts';
import { V, ownSelected, spectating } from './view_state.ts';
import { hotkeyProducer, groupForKey, groupOfType, hotkeyOf, itemsForKey, producerOfType } from './hotkeys.ts';
import { buildingIcon } from './render3d/icon3d.ts';
import { eraOf } from '../../game/production.ts';
import { techLevel } from '../../data/era.ts';
import { hideTooltip, showTooltip } from '../../components/tooltip/tooltip.ts';
import { priceText } from './components/build_cell.ts';
import { keyLabel } from './keyboard.ts';

interface Cell {
  root: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  count: HTMLElement;
}

let structureList: HTMLElement, unitList: HTMLElement;
/** units shown in their place but not trainable yet */
const locked = new Set<Buildable>();
/** One list shows at a time, picked with the Buildings / Units tabs. */
type Tab = 'structure' | 'unit';
let tab: Tab = 'structure';
let tabs: Record<Tab, { btn: HTMLElement; busy: HTMLElement }> | null = null;
/**
 * Phones only: a third tab, Selected, holds what's selected and its commands, so the bottom panel
 * shows one thing at a time. Selecting something opens it; deselecting goes back to the build tab
 * the player was on (Buildings or Units). Selection never jumps to a build tab.
 */
let selTab: HTMLElement | null = null, onSel = false, lastSel: unknown = null;
const narrow = (): boolean => matchMedia('(max-width: 760px)').matches;

function showTab(t: Tab): void {
  tab = t;
  structureList.parentElement?.classList.toggle('sidebar-build--structure', t === 'structure');
  structureList.parentElement?.classList.toggle('sidebar-build--unit', t === 'unit');
  showSel(false);
}

function showSel(on: boolean): void {
  on &&= narrow(); // the desktop sidebar shows the selection and the build lists together
  onSel = on;
  structureList.closest('.sidebar')?.classList.toggle('sidebar--sel', on);
  selTab?.setAttribute('aria-selected', String(on));
  if (tabs) for (const k of ['structure', 'unit'] as const) tabs[k].btn.setAttribute('aria-selected', String(!on && k === tab));
}

const tabOf = (t: Buildable): Tab => (isUnitType(t) ? 'unit' : 'structure');
const cells = new Map<Buildable, Cell>();
let listKey = '';

/** The description, plus damage per second (with this side's Armory upgrades) for anything armed. */
function withDps(t: Buildable): string {
  const wt = isUnitType(t) ? UNIT[t].weapon : t in BUILDING ? BUILDING[t as BldType].weapon : null;
  if (!wt) return descOf(t);
  return `${descOf(t)} · DPS ${dpsText(wt, isUnitType(t) ? teamWeaponBonus(V.team, t) : 1)}`;
}

function rebuild(structures: Buildable[], units: Buildable[]): void {
  // structure pictures follow the team's age, like the buildings on the map
  for (const t of [...structures, 'yard']) {
    if (t in BUILDING) ICON[t] = buildingIcon(t as BldType, V.team, eraOf(V.team)) ?? ICON[t];
  }
  const html = (list: Buildable[]) => list.map((t) => {
    const p = producerOfType(t);
    return buildCellHtml(t, nameOf(t), priceOf(t), ICON[t], withDps(t), hotkeyOf(t), p ? BUILDING[p].name : '', techLevel(t));
  }).join('');
  structureList.innerHTML = html(structures) || '<p class="build-empty">Needs a Town Hall</p>';
  unitList.innerHTML = html(units) || '<p class="build-empty">Build a Barracks or War Factory</p>';
  cells.clear();
  for (const root of document.querySelectorAll<HTMLElement>('.build-cell')) {
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    cells.set(root.dataset.type as Buildable, { root, progress: q('.build-cell-progress'), status: q('.build-cell-status'), count: q('.build-cell-count') });
  }
}

/** The building whose production hotkeys are live, if any (see hotkeyProducer). */
export function selectedProducer(): BldType | null {
  const hall = G.ents.some((e) => !e.dead && e.team === V.team && e.type === 'yard' && e.done);
  return hotkeyProducer(ownSelected(), hall);
}

/**
 * Production hotkey: with a producing building selected, its items' keys start them (or pick up a
 * structure to place), just like clicking them in the sidebar.
 */
export function productionHotkey(key: string): boolean {
  const b = selectedProducer();
  if (!b) return false;
  const group = V.keyGroup;
  if (!group) {
    const g = groupForKey(b, key);
    if (g) { V.keyGroup = g; return true; }
  }
  const type = itemsForKey(b, key, group).find((t) => available(V.team, lineOf(t)).includes(t));
  if (type) {
    activate(type);
    V.keyGroup = null;
    return true;
  }
  return !!group; // inside a group, other letters do nothing (Esc closes it)
}

/**
 * Left click: pick up a structure to place (paid for once placed, or as soon as the side can), or
 * queue or resume an order (it waits in the queue until the side can pay for it).
 */
function activate(type: Buildable): void {
  if (spectating() || locked.has(type)) return;
  showTab(tabOf(type));
  if (lineOf(type) === 'structure') {
    V.mode = { t: 'place', type: type as BldType, tx: 0, ty: 0, ok: false };
    return;
  }
  const it = itemsOf(V.team, type)[0];
  if (it?.hold) dispatch({ c: 'hold', type });
  else dispatch({ c: 'build', type });
}

/** Right click: put on hold, or cancel if already on hold (a structure: cancel its newest site). */
function holdOrCancel(type: Buildable): void {
  if (lineOf(type) === 'structure') {
    if (V.mode?.t === 'place' && V.mode.type === type) V.mode = null;
    else dispatch({ c: 'cancel', type });
    return;
  }
  const it = itemsOf(V.team, type)[0];
  if (!it) return;
  if (it.hold || it.ready) { dispatch({ c: 'cancel', type }); if (V.mode?.t === 'place' && V.mode.type === type) V.mode = null; }
  else dispatch({ c: 'hold', type });
}

export function refreshSidebar(): void {
  const structures = [...available(V.team, 'structure'), ...available(V.team, 'tech'), ...available(V.team, 'hospital'), ...available(V.team, 'armory')], units: Buildable[] = unitSlots(V.team);
  // every unit of the age keeps its place (Worker first); ones it can't train yet are greyed out
  const trainable = new Set<Buildable>([...available(V.team, 'infantry'), ...available(V.team, 'vehicle'), ...available(V.team, 'air')]);
  const key = `${V.team}|${eraOf(V.team)}|${Object.values(G.upg[V.team] ?? {}).join()}|${structures.join()}|${units.join()}`;
  if (key !== listKey) { listKey = key; rebuild(structures, units); }
  const producer = selectedProducer();
  // a new selection (V.sel is replaced whenever the player selects) opens Selected; none goes back
  if (V.sel !== lastSel) {
    lastSel = V.sel;
    if (V.sel.some((e) => !e.dead)) { if (!onSel) showSel(true); }
    else if (onSel) showSel(false);
  }
  // spectators can't build or train: no Buildings / Units tabs, just the radar and what's selected
  const bar = structureList.closest('.sidebar'), watch = spectating();
  if (bar && bar.classList.contains('sidebar--watch') !== watch) bar.classList.toggle('sidebar--watch', watch);
  const busy: Record<Tab, boolean> = { structure: false, unit: false };
  for (const [type, c] of cells) {
    const line = lineOf(type), structure = line === 'structure';
    // a structure's "items" are its sites going up on the map; the ring follows the one nearest done
    const sites = structure ? sitesOf(V.team, type as BldType) : [];
    const items = structure ? sites : itemsOf(V.team, type), first = structure ? null : itemsOf(V.team, type)[0], head = G.prod[V.team][line][0];
    // several Barracks can each be training one of a kind: the ring follows the one nearest done
    const prog = structure ? Math.max(0, ...sites.map((e) => e.prog)) : Math.max(0, ...itemsOf(V.team, type).filter((x) => x.at != null && !x.ready).map((x) => x.prog));
    const deg = Math.round(prog * 360);
    c.progress.style.background = items.length ? `conic-gradient(rgba(0,0,0,0) ${deg}deg, rgba(0,0,0,.6) 0)` : '';
    const placing = V.mode?.t === 'place' && V.mode.type === type;
    // an order (or a placed site) waiting until the side can pay for it
    const unpaid = structure ? sites.some((e) => e.unpaid) && !sites.some((e) => !e.unpaid) : !!first && head === first && !first.paid;
    const need = unpaid ? waitingFor(V.team, type) : null;
    const needs = isUnitType(type) && !trainable.has(type) ? unitNeeds(V.team, type) ?? 'yard' : null;
    locked.add(type);
    if (!needs) locked.delete(type);
    // research queues one after another: one waiting its turn shows its place in line
    const research = line === 'tech' || line === 'hospital' || line === 'armory';
    const place = research && first && first.at == null ? G.prod[V.team][line].indexOf(first) + 1 : 0;
    const status = needs ? `NEEDS\n${BUILDING[needs].name.toUpperCase()}` : placing ? 'PLACE' : first?.hold ? 'ON HOLD' : need ? `NEED ${need.toUpperCase()}` : place ? 'QUEUED' : !items.length && atLimit(V.team, type) ? 'IN THE FIELD' : '';
    if (c.status.textContent !== status) c.status.textContent = status;
    // a unit's count queued; a research's place in its line
    const count = place ? `#${place}` : (isUnitType(type) || structure) && items.length > (structure ? 1 : 0) ? String(items.length) : '';
    if (c.count.textContent !== count) c.count.textContent = count;
    c.root.classList.toggle('build-cell--locked', !!needs);
    c.root.classList.toggle('build-cell--active', items.length > 0);
    if (items.length) busy[tabOf(type)] = true;
    c.root.classList.toggle('build-cell--ready', placing);
    c.root.classList.toggle('build-cell--waiting', !!need);
    c.root.classList.toggle('build-cell--tech', research);
    // orders are paid in full up front: dim what the bank can't cover yet
    c.root.classList.toggle('build-cell--short', !canAfford(V.team, type) || (!items.length && atLimit(V.team, type)));
    c.root.classList.toggle('build-cell--keyed', !!producer && producerOfType(type) === producer && (!V.keyGroup || groupOfType(type) === V.keyGroup));
  }
  if (tabs) for (const k of ['structure', 'unit'] as const) {
    const hide = k === tab || !busy[k];
    if (tabs[k].busy.hidden !== hide) tabs[k].busy.hidden = hide;
  }
}

/** Hover card for a sidebar item: name and hotkey, what it does, then price and damage. */
function tooltipHtml(t: Buildable): string {
  const key = hotkeyOf(t), p = producerOfType(t);
  const keys = key ? ` ${key.split(' ').map((k) => `<kbd class="ui-key">${keyLabel(k)}</kbd>`).join('')}` : '';
  const wt = isUnitType(t) ? UNIT[t].weapon : t in BUILDING ? BUILDING[t as BldType].weapon : null;
  const dps = wt ? ` · DPS ${dpsText(wt, isUnitType(t) ? teamWeaponBonus(V.team, t) : 1)}` : '';
  const via = key && p ? `<br><small>Hotkey with the ${BUILDING[p].name} selected</small>` : '';
  return `<b>${nameOf(t)}</b>${keys}<br>${descOf(t)}<br><small>${priceText(priceOf(t))} · ${timeText(t)}${dps}</small>${via}`;
}

export function initSidebar(structures: HTMLElement, units: HTMLElement, tooltip: HTMLElement): void {
  structureList = structures;
  unitList = units;
  const tab0 = structures.parentElement?.querySelector<HTMLElement>('.build-tab--structure'), tab1 = structures.parentElement?.querySelector<HTMLElement>('.build-tab--unit');
  if (tab0 && tab1) {
    tabs = { structure: { btn: tab0, busy: tab0.querySelector('.build-tab-busy') as HTMLElement }, unit: { btn: tab1, busy: tab1.querySelector('.build-tab-busy') as HTMLElement } };
    // switching tabs drops a building being placed (nothing is paid until it is put down)
    const unplace = () => { if (V.mode?.t === 'place') V.mode = null; };
    // tabs switch on touch-down, not on click: a phone drops the click when the finger moves a
    // little during the tap, so the tab sometimes didn't switch. Keyboard (Enter/Space) still clicks.
    const onTab = (el: HTMLElement | null, go: () => void) => {
      if (!el) return;
      el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        unplace(); go();
      });
      el.addEventListener('click', (ev) => { if (ev.detail === 0) { unplace(); go(); } });
    };
    onTab(tab0, () => showTab('structure'));
    onTab(tab1, () => showTab('unit'));
    selTab = structures.parentElement?.querySelector<HTMLElement>('.build-tab--selection') ?? null;
    onTab(selTab, () => showSel(true));
  }
  showTab(tab);
  for (const list of [structures, units]) {
    list.addEventListener('mouseover', (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>('.build-cell');
      if (!cell) { hideTooltip(tooltip); return; }
      showTooltip(tooltip, tooltipHtml(cell.dataset.type as Buildable));
    });
    list.addEventListener('mouseleave', () => hideTooltip(tooltip));
    list.addEventListener('click', (ev) => {
      const el = ev.target as HTMLElement, cell = el.closest<HTMLElement>('.build-cell');
      if (!cell) return;
      const type = cell.dataset.type as Buildable;
      if (el.closest('.build-cell-cancel')) dispatch({ c: 'cancel', type });
      else activate(type);
    });
    list.addEventListener('contextmenu', (ev) => {
      const cell = (ev.target as HTMLElement).closest<HTMLElement>('.build-cell');
      if (!cell) return;
      ev.preventDefault();
      holdOrCancel(cell.dataset.type as Buildable);
    });
  }
}
