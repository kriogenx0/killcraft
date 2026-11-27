// The campaign screen: the missions in order, each with its brief and age limit. The first is always
// open; winning one opens the next (data/campaign.ts keeps the progress in this browser).
import { MISSIONS, ageLimit, unlocked, wonMissions, type Mission } from '../../data/campaign.ts';
import { AI_LEVEL } from '../../data/setup.ts';
import { closeModal, openModal } from '../../components/modal/modal.ts';

const MARKUP = `
  <h2 class="campaign-title">Campaign</h2>
  <p class="game-intro campaign-intro">Win a mission to open the next one.</p>
  <ol class="campaign-list" aria-label="Missions"></ol>
  <div class="ui-modal-actions">
    <button type="button" class="ui-button ui-button--secondary campaign-back">Back</button>
  </div>
`;

export interface CampaignOptions {
  onPlay: (m: Mission) => void;
  onBack: () => void;
}

export type Campaign = ReturnType<typeof mountCampaign>;

export function mountCampaign(root: HTMLElement, opts: CampaignOptions) {
  root.innerHTML = MARKUP;
  const list = root.querySelector('.campaign-list') as HTMLElement;
  root.querySelector('.campaign-back')!.addEventListener('click', () => { closeModal(root); opts.onBack(); });

  const render = () => {
    const won = wonMissions();
    let focus: HTMLButtonElement | null = null;
    list.replaceChildren(...MISSIONS.map((m, i) => {
      const open = unlocked(i, won), done = won.has(m.id);
      const li = document.createElement('li');
      li.className = `campaign-mission${open ? '' : ' campaign-mission--locked'}${done ? ' campaign-mission--won' : ''}`;
      const level = AI_LEVEL[m.setup.seats[1] === 'closed' ? 'normal' : m.setup.seats[1]].name;
      li.innerHTML = `
        <div class="campaign-mission-text">
          <span class="campaign-mission-name">${i + 1}. ${m.name}${done ? ' <span class="campaign-mission-check" title="Won">✓</span>' : ''}</span>
          <span class="campaign-mission-brief">${open ? m.brief : 'Win the mission before to unlock.'}</span>
          <span class="campaign-mission-meta">${ageLimit(m)} · ${level} computer</span>
        </div>`;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ui-button ui-button--small${done ? ' ui-button--secondary' : ''}`;
      b.textContent = !open ? 'Locked' : done ? 'Replay' : 'Play';
      b.disabled = !open;
      b.addEventListener('click', () => { closeModal(root); opts.onPlay(m); });
      if (open && !done && !focus) focus = b;
      li.append(b);
      return li;
    }));
    return focus as HTMLButtonElement | null;
  };

  return {
    open(): void {
      const next = render();
      openModal(root);
      next?.focus();
    },
  };
}
