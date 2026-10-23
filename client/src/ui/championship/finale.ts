import { computeStandings, type ChampionshipView, type DriverStanding, type SeasonTeam, type TeamStanding } from '@apex/shared';
import { avatarHtml, esc } from '../avatar.ts';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const CONFETTI = { count: 160, seconds: 7, colors: ['#ffd447', '#ff4d6d', '#3fc2ff', '#6dff9c', '#ffffff'] };

export interface FinaleSummary {
  champion: (DriverStanding & { wins: number; team: SeasonTeam | null }) | null;
  podium: DriverStanding[];
  teamChampion: TeamStanding | null;
}

/** Who to celebrate: the drivers' champion (points, race wins, team), the top three, the team champion. */
export function finaleSummary(view: ChampionshipView): FinaleSummary {
  const { drivers, teams } = computeStandings(view);
  // The stored champion is the truth (decided when the season finished); standings are a fallback.
  const first = drivers.find((d) => d.profile.id === view.championId) ?? drivers[0];
  return {
    champion: first
      ? {
          ...first,
          wins: first.perRound.filter((r) => r.race && !r.race.dnf && r.race.position === 1).length,
          team: view.teams.find((t) => t.id === first.teamId) ?? null,
        }
      : null,
    podium: drivers.slice(0, 3),
    teamChampion: teams[0] ?? null,
  };
}

/** The champion screen: photo, name, team, points and wins, the top three and the team champion, confetti. */
export function createFinale(root: HTMLElement) {
  let raf = 0;

  const confetti = (canvas: HTMLCanvasElement) => {
    const g = canvas.getContext('2d')!;
    const w = (canvas.width = innerWidth);
    const h = (canvas.height = innerHeight);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const bits = Array.from({ length: CONFETTI.count }, () => ({
      x: rand() * w,
      y: -rand() * h,
      vy: 60 + rand() * 120,
      vx: (rand() - 0.5) * 60,
      spin: rand() * 6,
      size: 6 + rand() * 6,
      color: CONFETTI.colors[Math.floor(rand() * CONFETTI.colors.length)]!,
    }));
    const start = performance.now();
    let last = start;
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      g.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.y += b.vy * dt;
        b.x += b.vx * dt;
        if (b.y > h + 20) b.y = -20;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.spin * (now / 1000));
        g.fillStyle = b.color;
        g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        g.restore();
      }
      if (now - start < CONFETTI.seconds * 1000 && !root.hidden) raf = requestAnimationFrame(frame);
      else g.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(frame);
  };

  const hide = () => {
    root.hidden = true;
    cancelAnimationFrame(raf);
  };

  return {
    show(view: ChampionshipView) {
      const s = finaleSummary(view);
      const c = s.champion;
      root.innerHTML = `
        <canvas class="fn-confetti"></canvas>
        <div class="fn-panel">
          <p class="fn-kicker">${esc(view.name)} · Champion</p>
          ${c ? avatarHtml({ ...c.profile, color: c.profile.livery.primary }, 180, 'fn-photo') : ''}
          <h1 class="fn-name">${esc(c?.profile.name ?? '—')}</h1>
          ${c ? `<p class="fn-line"><b>${c.points}</b> points · <b>${c.wins}</b> ${c.wins === 1 ? 'win' : 'wins'}${c.team ? ` · <span class="fn-team" style="--c:${hex(c.team.primary)}">${esc(c.team.name)}</span>` : ''}</p>` : ''}
          <div class="fn-podium">${[1, 0, 2]
            .map((i) => s.podium[i])
            .filter((d): d is DriverStanding => !!d)
            .map(
              (d) => `<div class="fn-step p${d.position}">${avatarHtml({ ...d.profile, color: d.profile.livery.primary }, d.position === 1 ? 72 : 56)}
                <span>${esc(d.profile.name)}</span><b>${d.points}</b><div class="fn-block">${d.position}</div></div>`,
            )
            .join('')}</div>
          ${s.teamChampion ? `<p class="fn-line">Teams' champion: <span class="fn-team" style="--c:${hex(s.teamChampion.team.primary)}">${esc(s.teamChampion.team.name)}</span> · ${s.teamChampion.points} points</p>` : ''}
          <button type="button" class="pf-primary fn-close">Close</button>
        </div>`;
      root.hidden = false;
      root.querySelector('.fn-close')!.addEventListener('click', hide);
      confetti(root.querySelector<HTMLCanvasElement>('.fn-confetti')!);
    },
    hide,
  };
}
