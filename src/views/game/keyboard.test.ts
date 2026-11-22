import { describe, expect, it } from 'vitest';
import { COMMAND_KEYS, ROTATE_KEYS, SCROLL_KEYS, scrollVector, tracksKey } from './keyboard.ts';

const ev = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }> = {}) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, target: { tagName: 'CANVAS' }, ...o });

describe('keyboard', () => {
  it('scrolls with W A S D and the arrow keys', () => {
    expect(scrollVector(['w'])).toEqual([0, -1]);
    expect(scrollVector(['a'])).toEqual([-1, 0]);
    expect(scrollVector(['s'])).toEqual([0, 1]);
    expect(scrollVector(['d'])).toEqual([1, 0]);
    expect(scrollVector(['arrowright', 'arrowdown'])).toEqual([1, 1]);
    expect(scrollVector(['w', 'd'])).toEqual([1, -1]);
  });

  it('cancels opposite keys and doesn’t double up W with Up', () => {
    expect(scrollVector(['a', 'd'])).toEqual([0, 0]);
    expect(scrollVector(['w', 'arrowup'])).toEqual([0, -1]);
    expect(scrollVector(['m', 'p'])).toEqual([0, 0]);
  });

  it('never uses a camera key as a command hotkey', () => {
    for (const k of Object.values(COMMAND_KEYS)) {
      expect(SCROLL_KEYS[k.toLowerCase()]).toBeUndefined();
      expect(ROTATE_KEYS[k.toLowerCase()]).toBeUndefined();
    }
  });

  it('ignores keys typed into fields or held with Cmd, Ctrl or Alt', () => {
    expect(tracksKey(ev())).toBe(true);
    expect(tracksKey(ev({ target: { tagName: 'INPUT' } }))).toBe(false);
    expect(tracksKey(ev({ target: { isContentEditable: true } }))).toBe(false);
    expect(tracksKey(ev({ metaKey: true }))).toBe(false);
    expect(tracksKey(ev({ ctrlKey: true }))).toBe(false);
    expect(tracksKey(ev({ altKey: true }))).toBe(false);
  });
});
