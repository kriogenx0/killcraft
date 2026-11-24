// Stages a big late-game battle for performance tests: every side jumps to the last age and gets
// a mixed army that marches on the middle of the map. Used by the bench and in the browser
// (?stress=N, see game_view.ts).
import { G } from '../game/state.ts';
import { MH, MW, TS } from '../game/const.ts';
import { LAST_ERA } from '../data/era.ts';
import { addUnit } from '../game/entity.ts';
import { applyCommand } from '../game/command.ts';
import type { UnitType } from '../data/unit.ts';

const MIX: UnitType[] = ['rifleman', 'gunner', 'rocket', 'tank', 'heavy', 'jeep', 'helicopter', 'drone', 'mage', 'knight', 'crossbowman', 'catapult'];

export function stageBattle(perSide: number): void {
  for (let team = 0; team < G.teams; team++) {
    const yard = G.ents.find((e) => !e.dead && e.team === team && e.type === 'yard') ?? G.ents.find((e) => !e.dead && e.team === team && e.kind === 'bld');
    if (!yard) continue;
    G.era[team] = LAST_ERA;
    const cx = yard.tx + 2, cy = yard.ty + 2, ids: number[] = [];
    let placed = 0;
    for (let r = 3; r < 20 && placed < perSide; r++) {
      for (let a = 0; a < r * 6 && placed < perSide; a++) {
        const tx = Math.round(cx + Math.cos((a / (r * 6)) * Math.PI * 2) * r), ty = Math.round(cy + Math.sin((a / (r * 6)) * Math.PI * 2) * r);
        if (tx < 1 || ty < 1 || tx >= MW - 1 || ty >= MH - 1 || G.blk[ty * MW + tx]) continue;
        const u = addUnit(MIX[placed % MIX.length], team, (tx + 0.5) * TS, (ty + 0.5) * TS);
        ids.push(u.id);
        placed++;
      }
    }
    applyCommand(team, { c: 'move', ids, tx: MW / 2 + (team % 2 ? 3 : -3), ty: MH / 2 + (team < 2 ? -3 : 3) });
  }
}
