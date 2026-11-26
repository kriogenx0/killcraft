import { describe, expect, it } from 'vitest';
import { BUILDING, BLD_TYPES } from '../../data/building.ts';
import { UNIT, UNIT_TYPES } from '../../data/unit.ts';
import { TECH, TECH_TYPES, isTechType } from '../../data/era.ts';
import { BUILDING_KEYS, COMMAND_KEYS, GLOBAL_KEYS, RESERVED_KEYS, ROTATE_KEYS, SCROLL_KEYS, assignKeys, keyLabel, normalizeKey } from './keyboard.ts';
import { PRODUCTION_KEYS, hotkeyProducer, groupForKey, groupOfType, hotkeyOf, itemForKey, itemsForKey, producerOfType } from './hotkeys.ts';

describe('hotkeys', () => {
  it('puts every age research on the same key, one at a time', () => {
    expect(hotkeyOf('age1')).toMatch(/^[A-Z]$/);
    expect(hotkeyOf('age2')).toBe(hotkeyOf('age1'));
    expect(itemsForKey('yard', hotkeyOf('age1').toLowerCase())).toEqual(['age1', 'age2']);
  });

  it('gives every structure, unit and research a key', () => {
    for (const t of [...BLD_TYPES.filter((b) => BUILDING[b].buildable), ...UNIT_TYPES.filter((u) => !UNIT[u].hatched && !UNIT[u].demon), ...TECH_TYPES]) {
      expect(hotkeyOf(t), t).toMatch(groupOfType(t) ? /^[A-Z] [A-Z]$/ : /^[A-Z]$/);
      expect(producerOfType(t), t).toBeDefined();
    }
  });

  it('never repeats a key within one building or group, or clashes with its commands or the camera', () => {
    const bldKeys = Object.values(BUILDING_KEYS).map((k) => k.toLowerCase());
    for (const [b, m] of PRODUCTION_KEYS) {
      // what one key press can mean: the top level holds ungrouped items and the group keys
      const menus = new Map<string, string[]>([['', [...m.groups.values()]]]);
      for (const [t, k] of m.items) {
        if (isTechType(t) && TECH[t].age != null && t !== 'age1') continue; // the ages share a key: one is on offer at a time
        const g = groupOfType(t) ?? '';
        menus.set(g, [...(menus.get(g) ?? []), k]);
      }
      for (const [g, list] of menus) {
        const keys = list.map((k) => k.toLowerCase());
        expect(new Set(keys).size, `${b} ${g}`).toBe(keys.length);
        for (const k of keys) {
          expect(RESERVED_KEYS.has(k), `${b} ${k}`).toBe(false);
          expect(bldKeys).not.toContain(k);
        }
      }
    }
  });

  it('puts the yard\'s walls, defenses and Aether structures behind a group key', () => {
    expect(groupForKey('yard', 'l')).toBe('Walls');
    expect(itemForKey('yard', hotkeyOf('stonewall').split(' ')[1].toLowerCase(), 'Walls')).toBe('stonewall');
    expect(itemForKey('yard', hotkeyOf('stonewall').split(' ')[1].toLowerCase())).not.toBe('stonewall');
    expect(groupOfType('tower')).toBe('Defenses');
    expect(groupOfType('shrine')).toBe('Aether');
    expect(groupOfType('barracks')).toBeUndefined();
  });

  it('keeps unit, building and global keys off the camera keys and apart from each other', () => {
    const all = [...Object.values(COMMAND_KEYS), ...Object.values(BUILDING_KEYS), ...Object.values(GLOBAL_KEYS)].map((k) => k.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) {
      expect(SCROLL_KEYS[k]).toBeUndefined();
      expect(ROTATE_KEYS[k]).toBeUndefined();
    }
  });

  it('looks items up by key for the selected building', () => {
    expect(itemForKey('yard', hotkeyOf('barracks').toLowerCase())).toBe('barracks');
    expect(itemForKey('factory', 't')).toBe('tank');
    expect(itemForKey('barracks', 't')).not.toBe('tank');
    expect(itemForKey('power', 'b')).toBeUndefined();
  });

  it('prefers a chosen key, then initials, and never a reserved letter', () => {
    const m = assignKeys([
      { id: 'a', name: 'Rocket Factory' },
      { id: 'b', name: 'Factory', key: 'K' },
      { id: 'c', name: 'Fort' },
      { id: 'd', name: 'Swamp' },
    ], ['r']);
    expect(m.get('b')).toBe('K');
    expect(m.get('a')).toBe('F');
    expect(m.get('c')).toBe('O');
    expect(m.get('d')).toBe('M');
  });

  it('shows and reads Delete the same way on Mac and PC', () => {
    expect(keyLabel('Delete')).toBe('Del');
    expect(normalizeKey('Backspace')).toBe('delete');
    expect(normalizeKey('K')).toBe('k');
  });
});

describe('whose production keys are live', () => {
  const unit = { kind: 'unit', type: 'worker' };
  it('uses the Town Hall when no building is selected, so sidebar letters always work', () => {
    expect(hotkeyProducer([], true)).toBe('yard');
    expect(hotkeyProducer([unit], true)).toBe('yard');
    expect(hotkeyProducer([], false)).toBeNull();
  });
  it('uses a selected producer, and nothing for a building that makes nothing or is unfinished', () => {
    expect(hotkeyProducer([{ kind: 'bld', type: 'barracks', done: true }], true)).toBe('barracks');
    expect(hotkeyProducer([{ kind: 'bld', type: 'power', done: true }], true)).toBeNull();
    expect(hotkeyProducer([{ kind: 'bld', type: 'barracks', done: false }], true)).toBeNull();
  });
});
