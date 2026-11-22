import { describe, expect, it } from 'vitest';
import { BUILDING, BLD_TYPES } from '../../data/building.ts';
import { UNIT_TYPES } from '../../data/unit.ts';
import { TECH_TYPES } from '../../data/era.ts';
import { BUILDING_KEYS, COMMAND_KEYS, GLOBAL_KEYS, RESERVED_KEYS, ROTATE_KEYS, SCROLL_KEYS, assignKeys, keyLabel, normalizeKey } from './keyboard.ts';
import { PRODUCTION_KEYS, hotkeyOf, itemForKey, producerOfType } from './hotkeys.ts';

describe('hotkeys', () => {
  it('gives every structure, unit and research a key', () => {
    for (const t of [...BLD_TYPES.filter((b) => BUILDING[b].buildable), ...UNIT_TYPES, ...TECH_TYPES]) {
      expect(hotkeyOf(t), t).toMatch(/^[A-Z]$/);
      expect(producerOfType(t), t).toBeDefined();
    }
  });

  it('never repeats a key within one building, or clashes with its commands or the camera', () => {
    const bldKeys = Object.values(BUILDING_KEYS).map((k) => k.toLowerCase());
    for (const [b, m] of PRODUCTION_KEYS) {
      const keys = [...m.values()].map((k) => k.toLowerCase());
      expect(new Set(keys).size, b).toBe(keys.length);
      for (const k of keys) {
        expect(RESERVED_KEYS.has(k), `${b} ${k}`).toBe(false);
        expect(bldKeys).not.toContain(k);
      }
    }
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
