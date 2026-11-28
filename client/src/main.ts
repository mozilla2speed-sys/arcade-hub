import '@fontsource/russo-one/400.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/600.css';
import '@fontsource/rubik/700.css';
import './style.css';
import { connect, type NetClient } from './net.js';
import { CarGame, lapsText } from './games/car/CarGame.js';
import { isMuted, setMuted, unlockAudio } from './games/car/sound.js';
import { createPreview, type PreviewChoice } from './preview.js';
import { isTheme, type Theme } from './theme.js';
import {
  CARS,
  CAR_COLORS,
  DEFAULT_CAR,
  getCar,
  isCarId,
  type CarSpec,
} from '../../shared/src/games/car/cars.js';
import {
  DEFAULT_TRACK,
  TRACKS,
  getTrack,
  isTrackId,
} from '../../shared/src/games/car/tracks.js';
import type { ServerMessage } from '../../shared/src/messages.js';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const menu = byId('menu');
const hud = byId('hud');
const statusEl = byId('status');
const nickInput = byId<HTMLInputElement>('nick');
const codeInput = byId<HTMLInputElement>('code');
const joinBtn = byId<HTMLButtonElement>('joinCode');
const quickBtn = byId<HTMLButtonElement>('quick');
const friends = byId('friends');
const friendsToggle = byId('friendsToggle');
const menuBtn = byId('menuBtn');
const actions = byId('actions');
const soundBtn = byId('soundBtn');
const copyLinkBtn = byId('copyLink');
const installBtn = byId<HTMLButtonElement>('installBtn');

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

// ---- choices: saved on this device, a share link may override code and map ----
const params = new URLSearchParams(location.search);
const urlCode = params.get('code')?.trim().toLowerCase().slice(0, 20);
const urlMap = params.get('map');

nickInput.value = load('arcade_nick') ?? '';
codeInput.value = urlCode || load('arcade_code') || 'garage';

const savedTheme = load('turbo_theme');
const savedMap = load('turbo_map');
const savedCar = load('turbo_car');
const savedColor = Number(load('turbo_color') ?? 0);

const choice: PreviewChoice = {
  theme: isTheme(savedTheme) ? savedTheme : 'day',
  map: isTrackId(urlMap) ? urlMap : isTrackId(savedMap) ? savedMap : DEFAULT_TRACK,
  car: isCarId(savedCar) ? savedCar : DEFAULT_CAR,
  color: CAR_COLORS[savedColor] ? savedColor : 0,
};

let net: NetClient | null = null;
let connecting = false;
let game: CarGame | null = null;
let currentRoom = { code: '', map: choice.map };
/** the map the player asked for, to tell them when the room has another one */
let wantedMap = choice.map;

let preview: ReturnType<typeof createPreview> | null = null;
try {
  preview = createPreview({ ...choice });
  preview.start();
} catch (err) {
  console.error(err);
  setStatus('Браузер не смог запустить 3D-графику (WebGL)');
}

function setStatus(t: string) {
  statusEl.textContent = t;
}

// ---- menu widgets ----
function radios<T>(
  container: HTMLElement,
  items: readonly T[],
  build: (item: T, button: HTMLButtonElement, index: number) => void,
  pick: (item: T, index: number) => void,
) {
  container.replaceChildren(
    ...items.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      build(item, button, index);
      button.addEventListener('click', () => {
        pick(item, index);
        render();
      });
      return button;
    }),
  );
}

function check(container: HTMLElement, index: number) {
  [...container.children].forEach((child, i) => child.setAttribute('aria-checked', String(i === index)));
}

radios(byId('carList'), CARS, (car, button) => {
  button.className = 'chip';
  button.textContent = car.name;
}, (car) => {
  choice.car = car.id;
  save('turbo_car', car.id);
});

radios(byId('colorList'), CAR_COLORS, (color, button) => {
  button.className = 'swatch';
  button.style.background = color.hex;
  button.setAttribute('aria-label', color.name);
}, (_color, index) => {
  choice.color = index;
  save('turbo_color', String(index));
});

radios(byId('mapList'), TRACKS, (track, button) => {
  button.className = 'chip';
  const length = document.createElement('small');
  length.textContent = `круг ${(Math.round(track.length / 10) * 10).toLocaleString('ru-RU')} м`;
  button.append(track.name, length);
}, (track) => {
  choice.map = track.id;
  save('turbo_map', track.id);
});

const STAT_NAMES: [keyof CarSpec['stats'], string][] = [
  ['speed', 'Скорость'],
  ['accel', 'Разгон'],
  ['handling', 'Повороты'],
  ['offroad', 'Трава'],
];

function render() {
  document.body.dataset.theme = choice.theme;
  for (const button of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice.theme));
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', choice.theme === 'day' ? '#8fd8ff' : '#0c0824');

  const car = getCar(choice.car);
  check(byId('carList'), CARS.findIndex((c) => c.id === car.id));
  check(byId('colorList'), choice.color);
  byId('carAbout').textContent = car.about;
  byId('carStats').replaceChildren(
    ...STAT_NAMES.map(([key, name]) => {
      const row = document.createElement('div');
      row.className = 'meter';
      const label = document.createElement('span');
      label.textContent = name;
      const bar = document.createElement('span');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${car.stats[key]} из 5`);
      for (let i = 1; i <= 5; i++) {
        const cell = document.createElement('i');
        if (i <= car.stats[key]) cell.className = 'on';
        bar.append(cell);
      }
      row.append(label, bar);
      return row;
    }),
  );

  const track = getTrack(choice.map);
  check(byId('mapList'), TRACKS.findIndex((t) => t.id === track.id));
  byId('mapAbout').textContent = `${track.about} · ${lapsText(track.laps)}`;

  preview?.set({ ...choice });
}

for (const button of document.querySelectorAll<HTMLElement>('[data-theme-choice]')) {
  button.addEventListener('click', () => {
    choice.theme = button.dataset.themeChoice as Theme;
    save('turbo_theme', choice.theme);
    render();
  });
}

function showFriends(open: boolean) {
  friends.hidden = !open;
  // one big button at a time: a friend who opened a link must not hit quick play by mistake
  quickBtn.hidden = open;
  joinBtn.hidden = !open;
  byId('shareMenu').hidden = !open;
  friendsToggle.setAttribute('aria-expanded', String(open));
  friendsToggle.textContent = open ? 'Быстрая игра' : 'Играть с друзьями';
}
friendsToggle.addEventListener('click', () => {
  showFriends(friends.hidden === true);
  if (!friends.hidden) byId('panelScroll').scrollTo({ top: 0, behavior: 'smooth' });
});
showFriends(Boolean(urlCode));
render();

// ---- layout: on-screen buttons for touch screens and narrow windows ----
const touchScreen = matchMedia('(pointer: coarse)');
const updateLayout = () => {
  document.body.classList.toggle('compact', touchScreen.matches || innerWidth < 760);
};
addEventListener('resize', updateLayout);
updateLayout();

function showGameUI(show: boolean) {
  menu.hidden = show;
  hud.hidden = !show;
  if (show) preview?.stop();
  else preview?.start();
}

function setJoinButtons(enabled: boolean) {
  joinBtn.disabled = quickBtn.disabled = !enabled;
}

/** Close the connection on purpose: its close event must not look like a lost one. */
function disconnect() {
  if (!net) return;
  net.close();
  net = null;
}

function roomUrl(code: string, map: string) {
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('code', code);
  // whoever opens the link first creates the room, so the map travels with it
  u.searchParams.set('map', map);
  return u.toString();
}

async function copyRoomLink(link: string) {
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    prompt('Скопируйте ссылку:', link);
    return false;
  }
}

const typedCode = () => codeInput.value.trim().toLowerCase() || 'garage';

byId('shareMenu').addEventListener('click', async () => {
  if (await copyRoomLink(roomUrl(typedCode(), choice.map))) {
    setStatus('Ссылка скопирована');
    setTimeout(() => setStatus(''), 2000);
  }
});

copyLinkBtn.addEventListener('click', async () => {
  copyLinkBtn.blur();
  if (!currentRoom.code) return;
  if (await copyRoomLink(roomUrl(currentRoom.code, currentRoom.map))) {
    copyLinkBtn.textContent = 'Скопировано';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Ссылка';
    }, 1500);
  }
});

function renderSoundButton() {
  soundBtn.textContent = isMuted() ? 'Звук: выкл' : 'Звук: вкл';
  soundBtn.setAttribute('aria-pressed', String(!isMuted()));
}
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  renderSoundButton();
  // a focused button would also react to Space, the handbrake
  soundBtn.blur();
});
renderSoundButton();

function openActions(open: boolean) {
  actions.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
}
menuBtn.addEventListener('click', () => {
  openActions(!actions.classList.contains('open'));
  menuBtn.blur();
});

async function start(quick: boolean) {
  // Enter in an input bypasses the disabled buttons
  if (connecting || net || !preview) return;
  unlockAudio();
  const nick = nickInput.value.trim() || 'Гонщик';
  const code = typedCode();
  save('arcade_nick', nickInput.value.trim());
  if (!quick) save('arcade_code', code);
  (document.activeElement as HTMLElement | null)?.blur();
  wantedMap = choice.map;

  setStatus('Подключение…');
  setJoinButtons(false);
  connecting = true;

  try {
    net = await connect({ onMessage: handleMessage, onClose: handleConnectionLost });
  } catch {
    setStatus('Не удалось подключиться к серверу');
    setJoinButtons(true);
    return;
  } finally {
    connecting = false;
  }

  net.send({
    type: 'join',
    nick,
    code: quick ? undefined : code,
    quick,
    game: 'car',
    map: choice.map,
    car: choice.car,
    color: choice.color,
  });
}

function handleMessage(msg: ServerMessage) {
  if (msg.type === 'welcome') {
    setStatus('');
    currentRoom = { code: msg.roomCode, map: msg.map };
    // reflect the real room in the address without a reload
    history.replaceState(null, '', roomUrl(msg.roomCode, msg.map));
    byId('popRoom').textContent =
      `Комната: ${msg.roomCode}` +
      (msg.map !== wantedMap ? ` · трасса этой комнаты: ${getTrack(msg.map).name}` : '');
    showGameUI(true);
    openActions(false);
    game = new CarGame(net!, msg.playerId, msg.roomCode, msg.map, msg.players, choice.theme);
    game.start();
  } else if (msg.type === 'error' || msg.type === 'room_full') {
    setStatus(msg.type === 'error' ? msg.message : 'Комната заполнена');
    // Join was refused: return to a usable menu
    if (!game) {
      disconnect();
      setJoinButtons(true);
    }
  } else if (game) {
    game.handleServer(msg);
  }
}

function handleConnectionLost() {
  setStatus('Соединение потеряно');
  stopGame();
}

function stopGame() {
  const wasPlaying = game !== null;
  if (game) {
    game.destroy();
    game = null;
  }
  disconnect();
  currentRoom = { code: '', map: choice.map };
  if (wasPlaying) showGameUI(false);
  setJoinButtons(true);
}

function leave() {
  stopGame();
  setStatus('');
  history.replaceState(null, '', location.pathname);
}

joinBtn.addEventListener('click', () => start(false));
quickBtn.addEventListener('click', () => start(true));
byId('back').addEventListener('click', leave);
byId('resultsBack').addEventListener('click', leave);

nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start(friends.hidden === true);
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') start(false);
});

// ---- PWA: service worker + install prompt ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline / blocked */
    });
  });
}

interface InstallPrompt extends Event {
  prompt(): void;
  userChoice: Promise<unknown>;
}
let deferredPrompt: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as InstallPrompt;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  deferredPrompt = null;
});

// Auto-join if opened via ?code= and ?join=1
if (params.get('join') === '1' && urlCode) {
  // slight delay so UI paints
  setTimeout(() => start(false), 300);
}
