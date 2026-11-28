/** Everything drawn over the race in HTML. User text only goes through textContent. */
import {
  FINISH_GRACE_SEC,
  type CarState,
  type RaceResultRow,
} from '../../../../shared/src/messages.js';
import { CAR_COLORS } from '../../../../shared/src/games/car/cars.js';

const byId = (id: string) => document.getElementById(id)!;

export function formatTime(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** Running order: finishers by place, then the rest by distance, spectators last. */
export function raceOrder(cars: CarState[]) {
  return [...cars].sort((a, b) => {
    if (a.waiting !== b.waiting) return a.waiting ? 1 : -1;
    if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
}

function el(tag: string, className: string, text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** Only touch the page when something changed: this runs every frame. */
export function setText(id: string, text: string) {
  const node = byId(id);
  if (node.textContent !== text) node.textContent = text;
}

export function updateBoard(order: CarState[], myId: string, roomCode: string, totalLaps: number) {
  setText('roomName', `Комната: ${roomCode}`);
  byId('boardList').replaceChildren(
    ...order.map((c, i) => {
      const row = el('div', c.id === myId ? 'row me' : 'row');
      const dot = el('i', 'dot');
      dot.style.background = CAR_COLORS[c.color]?.hex ?? '#888';
      const status = c.waiting
        ? 'ждёт'
        : c.finished
          ? 'финиш'
          : `круг ${Math.min(c.laps + 1, totalLaps)}/${totalLaps}`;
      row.append(
        dot,
        el('span', 'name', `${i + 1}. ${c.nick}${c.id === myId ? ' (вы)' : ''}`),
        el('span', 'status', status),
      );
      return row;
    }),
  );
}

export function showBanner(text: string) {
  setText('banner', text);
  byId('banner').classList.toggle('show', text !== '');
}

export function showOverlay(big: string, small = '') {
  setText('overlayText', big);
  setText('overlaySub', small);
  byId('overlayText').classList.toggle('word', big.length > 3);
  byId('overlay').classList.toggle('show', big !== '');
}

export function graceText(left: number | undefined) {
  return left !== undefined && left <= FINISH_GRACE_SEC ? `Финиш закроется через ${left}\u00a0с` : '';
}

export function showResults(rows: RaceResultRow[], myId: string) {
  const mine = rows.find((r) => r.id === myId);
  setText(
    'resultsSummary',
    !mine ? 'Вы стартуете в следующем заезде' : mine.finished ? `Вы заняли ${mine.place}-е место` : `Вы не успели финишировать · ${mine.place}-е место`,
  );
  byId('resultsList').replaceChildren(
    ...rows.map((r) => {
      const row = el('div', r.id === myId ? 'result me' : 'result');
      const main = el('div', 'who');
      main.append(el('b', '', r.nick));
      if (r.best) main.append(el('small', '', `лучший круг ${formatTime(r.best)}`));
      row.append(
        el('span', 'place', String(r.place)),
        main,
        el('span', 'time', r.finished ? formatTime(r.totalTime) : 'не финишировал'),
      );
      return row;
    }),
  );
  byId('results').classList.add('show');
}

export function hideResults() {
  byId('results').classList.remove('show');
}

export function resetHud() {
  showBanner('');
  showOverlay('');
  hideResults();
  byId('boardList').replaceChildren();
  setText('nextRace', '');
  byId('actions').classList.remove('open');
}
