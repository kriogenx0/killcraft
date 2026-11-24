import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { G, type Ent } from '../../game/state.ts';
import { V } from './view_state.ts';
import { followable, followingSelection, stopFollow, toggleFollow, updateFollow } from './follow_cam.ts';

const unit = (id: number, x: number, y: number): Ent => ({ id, team: 0, dead: false, kind: 'unit', x, y } as Ent);

describe('follow cam', () => {
  let u: Ent;
  beforeEach(() => {
    u = unit(901, 600, 500);
    G.byId.set(u.id, u);
    V.team = 0;
    V.sel = [u];
    Object.assign(V.cam, { x: 100, y: 100 });
  });
  afterEach(() => { G.byId.delete(u.id); stopFollow(); V.sel = []; G.demo = false; });

  it('glides the camera onto the selected unit and keeps it there as it moves', () => {
    toggleFollow();
    expect(followingSelection()).toBe(true);
    for (let i = 0; i < 120; i++) updateFollow(1 / 60);
    expect(V.cam.x).toBeCloseTo(600, 0);
    expect(V.cam.y).toBeCloseTo(500, 0);
    u.x = 700;
    for (let i = 0; i < 120; i++) updateFollow(1 / 60);
    expect(V.cam.x).toBeCloseTo(700, 0);
  });

  it('lets go when the map is panned by hand', () => {
    toggleFollow();
    updateFollow(1 / 60);
    V.cam.x += 40;
    updateFollow(1 / 60);
    expect(V.follow).toBeNull();
  });

  it('lets go when the unit dies', () => {
    toggleFollow();
    updateFollow(1 / 60);
    u.dead = true;
    updateFollow(1 / 60);
    expect(V.follow).toBeNull();
    expect(followable()).toBeNull();
  });

  it('toggles off on a second press', () => {
    toggleFollow();
    toggleFollow();
    expect(V.follow).toBeNull();
  });

  it('follows any side while spectating', () => {
    G.demo = true;
    u.team = 1;
    toggleFollow();
    expect(V.follow).toBe(u.id);
  });
});
