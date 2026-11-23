// The production sidebar: one column of structures, one of units. Cells are created when the
// available list changes and updated in place every frame, so clicks are never lost.
import { G } from '../../game/state.ts';
import { isUnitType } from '../../data/unit.ts';
import { BUILDING, type BldType } from '../../data/building.ts';
import { available, canAfford, priceOf, descOf, itemsOf, lineOf, nameOf, sitesOf, type Buildable } from '../../game/production.ts';
import { dispatch } from './dispatch.ts';
import { buildCellHtml } from './components/build_cell.ts';
import { ICON } from './render/icon.ts';
import { V, ownSelected, spectating } from './view_state.ts';
import { hotkeyOf, itemForKey, producerOfType } from './hotkeys.ts';
import { buildingIcon } from './render3d/icon3d.ts';
import { eraOf } from '../../game/production.ts';

interface Cell {
  root: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  count: HTMLElement;
}

let structureList: HTMLElement, unitList: HTMLElement;
const cells = new Map<Buildable, Cell>();
let listKey = '';

function rebuild(structures: Buildable[], units: Buildable[]): void {
  // structure pictures follow the team's age, like the buildings on the map
  for (const t of [...structures, 'yard']) {
    if (t in BUILDING) ICON[t] = buildingIcon(t as BldType, V.team, eraOf(V.team)) ?? ICON[t];
  }
  const html = (list: Buildable[]) => list.map((t) => {
    const p = producerOfType(t);
    return buildCellHtml(t, nameOf(t), priceOf(t), ICON[t], descOf(t), hotkeyOf(t), p ? BUILDING[p].name : '');
  }).join('');
  structureList.innerHTML = html(structures) || '<p class="build-empty">Needs a Construction Yard</p>';
  unitList.innerHTML = html(units) || '<p class="build-empty">Build a Barracks or War Factory</p>';
  cells.clear();
  for (const root of document.querySelectorAll<HTMLElement>('.build-cell')) {
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    cells.set(root.dataset.type as Buildable, { root, progress: q('.build-cell-progress'), status: q('.build-cell-status'), count: q('.build-cell-count') });
  }
}

/** The selected building whose production hotkeys are live, if any. */
export function selectedProducer(): BldType | null {
  const b = ownSelected().find((e) => e.kind === 'bld' && e.done);
  return b && b.kind === 'bld' ? (b.type as BldType) : null;
}

/**
 * Production hotkey: with a producing building selected, its items' keys start them (or pick up a
 * structure to place), just like clicking them in the sidebar.
 */
export function productionHotkey(key: string): boolean {
  const b = selectedProducer(), type = b && itemForKey(b, key);
  if (!type || !available(V.team, lineOf(type)).includes(type)) return false;
  activate(type);
  return true;
}

/** Left click: pick up a structure to place (it's paid for and built once placed), or start or resume an order. */
function activate(type: Buildable): void {
  if (spectating()) return;
  if (lineOf(type) === 'structure') {
    // can't afford it: the build command just reports what's short
    if (canAfford(V.team, type)) V.mode = { t: 'place', type: type as BldType, tx: 0, ty: 0, ok: false };
    else dispatch({ c: 'build', type });
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
  const structures = [...available(V.team, 'structure'), ...available(V.team, 'tech'), ...available(V.team, 'hospital'), ...available(V.team, 'armory')], units = [...available(V.team, 'infantry'), ...available(V.team, 'vehicle'), ...available(V.team, 'air')];
  const key = `${V.team}|${eraOf(V.team)}|${structures.join()}|${units.join()}`;
  if (key !== listKey) { listKey = key; rebuild(structures, units); }
  const producer = selectedProducer();
  for (const [type, c] of cells) {
    const line = lineOf(type), structure = line === 'structure';
    // a structure's "items" are its sites going up on the map; the ring follows the one nearest done
    const sites = structure ? sitesOf(V.team, type as BldType) : [];
    const items = structure ? sites : itemsOf(V.team, type), first = structure ? null : itemsOf(V.team, type)[0], head = G.prod[V.team][line][0];
    const prog = structure ? Math.max(0, ...sites.map((e) => e.prog)) : head && head.type === type && !head.ready ? head.prog : 0;
    const deg = Math.round(prog * 360);
    c.progress.style.background = items.length ? `conic-gradient(rgba(0,0,0,0) ${deg}deg, rgba(0,0,0,.6) 0)` : '';
    const placing = V.mode?.t === 'place' && V.mode.type === type;
    const status = placing ? 'PLACE' : first?.hold ? 'ON HOLD' : '';
    if (c.status.textContent !== status) c.status.textContent = status;
    const count = (isUnitType(type) || structure) && items.length > (structure ? 1 : 0) ? String(items.length) : '';
    if (c.count.textContent !== count) c.count.textContent = count;
    c.root.classList.toggle('build-cell--active', items.length > 0);
    c.root.classList.toggle('build-cell--ready', placing);
    c.root.classList.toggle('build-cell--tech', line === 'tech' || line === 'hospital' || line === 'armory');
    // orders are paid in full up front: dim what the bank can't cover yet
    c.root.classList.toggle('build-cell--short', !items.length && !canAfford(V.team, type));
    c.root.classList.toggle('build-cell--keyed', !!producer && producerOfType(type) === producer);
  }
}

export function initSidebar(structures: HTMLElement, units: HTMLElement): void {
  structureList = structures;
  unitList = units;
  for (const list of [structures, units]) {
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
