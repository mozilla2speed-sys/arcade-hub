import { connect, type NetClient } from './net.js';
import { CarGame } from './games/car/CarGame.js';
import type { GameId, ServerMessage } from '../../shared/src/messages.js';

const menu = document.getElementById('menu')!;
const statusEl = document.getElementById('status')!;
const nickInput = document.getElementById('nick') as HTMLInputElement;
const codeInput = document.getElementById('code') as HTMLInputElement;
const joinBtn = document.getElementById('joinCode')!;
const quickBtn = document.getElementById('quick')!;
const backBtn = document.getElementById('back')!;
const keysEl = document.getElementById('keys')!;
const hudEl = document.getElementById('hud')!;
const playersEl = document.getElementById('players')!;
const shareMenuBtn = document.getElementById('shareMenu')!;
const copyLinkBtn = document.getElementById('copyLink')!;
const installBtn = document.getElementById('installBtn') as HTMLButtonElement;

// Restore saved fields
try {
  const savedNick = localStorage.getItem('arcade_nick');
  const savedCode = localStorage.getItem('arcade_code');
  if (savedNick) nickInput.value = savedNick;
  if (savedCode) codeInput.value = savedCode;
} catch {
  /* private mode */
}

// URL ?code=garage overrides localStorage (share link)
const params = new URLSearchParams(location.search);
const urlCode = params.get('code');
if (urlCode) {
  codeInput.value = urlCode.trim().toLowerCase().slice(0, 20);
}

let net: NetClient | null = null;
let connecting = false;
let game: CarGame | null = null;
let currentRoomCode = '';

function setStatus(t: string) {
  statusEl.textContent = t;
}

function showGameUI(show: boolean) {
  menu.style.display = show ? 'none' : 'flex';
  keysEl.style.display = show ? 'block' : 'none';
  hudEl.style.display = show ? 'block' : 'none';
  playersEl.style.display = show ? 'block' : 'none';
  backBtn.style.display = show ? 'block' : 'none';
  copyLinkBtn.style.display = show ? 'block' : 'none';
}

function setJoinButtons(enabled: boolean) {
  for (const btn of [joinBtn, quickBtn]) {
    if (enabled) btn.removeAttribute('disabled');
    else btn.setAttribute('disabled', 'true');
  }
}

/** Close the connection on purpose: its close event must not look like a lost one. */
function disconnect() {
  if (!net) return;
  net.close();
  net = null;
}

function saveFields(nick: string, code: string) {
  try {
    localStorage.setItem('arcade_nick', nick);
    localStorage.setItem('arcade_code', code);
  } catch {
    /* ignore */
  }
}

function roomUrl(code: string) {
  const u = new URL(location.href);
  u.searchParams.set('code', code);
  // strip hash
  u.hash = '';
  return u.toString();
}

async function copyRoomLink(code: string) {
  const link = roomUrl(code);
  try {
    await navigator.clipboard.writeText(link);
    setStatus('Ссылка скопирована');
    return true;
  } catch {
    // fallback
    prompt('Скопируйте ссылку:', link);
    return false;
  }
}

shareMenuBtn.addEventListener('click', () => {
  const code = codeInput.value.trim().toLowerCase() || 'garage';
  copyRoomLink(code).then((ok) => {
    if (ok) setTimeout(() => setStatus(''), 2000);
  });
});

copyLinkBtn.addEventListener('click', () => {
  if (!currentRoomCode) return;
  copyRoomLink(currentRoomCode).then(() => {
    copyLinkBtn.textContent = 'Скопировано';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Ссылка';
    }, 1500);
  });
});

async function start(quick: boolean) {
  // Enter in an input bypasses the disabled buttons
  if (connecting || net) return;
  const nick = nickInput.value.trim() || 'Гонщик';
  const code = codeInput.value.trim().toLowerCase() || 'garage';
  saveFields(nick, code);

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
    game: 'car' as GameId,
  });
}

function handleMessage(msg: ServerMessage) {
  if (msg.type === 'welcome') {
    setStatus('');
    currentRoomCode = msg.roomCode;
    // reflect real room in URL without reload
    try {
      const u = new URL(location.href);
      u.searchParams.set('code', msg.roomCode);
      history.replaceState(null, '', u.toString());
    } catch {
      /* ignore */
    }
    showGameUI(true);
    if (msg.game === 'car') {
      game = new CarGame(net!, msg.playerId, msg.roomCode, msg.players);
      game.start();
    }
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
  if (game) {
    game.destroy();
    game = null;
  }
  disconnect();
  currentRoomCode = '';
  showGameUI(false);
  setJoinButtons(true);
}

joinBtn.addEventListener('click', () => start(false));
quickBtn.addEventListener('click', () => start(true));
backBtn.addEventListener('click', () => {
  stopGame();
  setStatus('');
});

[nickInput, codeInput].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start(false);
  });
});

// ---- PWA: service worker + install prompt ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline / blocked */
    });
  });
}

let deferredPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'block';
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  installBtn.style.display = 'none';
  deferredPrompt = null;
});

// Auto-join if opened via ?code= and ?join=1
if (params.get('join') === '1' && urlCode) {
  // slight delay so UI paints
  setTimeout(() => start(false), 300);
}
