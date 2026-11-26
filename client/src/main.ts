import { connect, type NetClient } from './net.js';
import { CarGame } from './games/car/CarGame.js';
import type { GameId } from '../../shared/src/messages.js';

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

// Restore saved fields (frontend only — server never stores accounts)
try {
  const savedNick = localStorage.getItem('arcade_nick');
  const savedCode = localStorage.getItem('arcade_code');
  if (savedNick) nickInput.value = savedNick;
  if (savedCode) codeInput.value = savedCode;
} catch {
  /* private mode / blocked storage */
}

let net: NetClient | null = null;
let game: CarGame | null = null;

function setStatus(t: string) {
  statusEl.textContent = t;
}

function showGameUI(show: boolean) {
  menu.style.display = show ? 'none' : 'flex';
  keysEl.style.display = show ? 'block' : 'none';
  hudEl.style.display = show ? 'block' : 'none';
  playersEl.style.display = show ? 'block' : 'none';
  backBtn.style.display = show ? 'block' : 'none';
}

function saveFields(nick: string, code: string) {
  try {
    localStorage.setItem('arcade_nick', nick);
    localStorage.setItem('arcade_code', code);
  } catch {
    /* ignore */
  }
}

async function start(quick: boolean) {
  const nick = nickInput.value.trim() || 'Гонщик';
  const code = codeInput.value.trim().toLowerCase() || 'garage';
  saveFields(nick, code);

  setStatus('Подключение…');
  joinBtn.setAttribute('disabled', 'true');
  quickBtn.setAttribute('disabled', 'true');

  try {
    net = await connect();
  } catch (e) {
    setStatus('Не удалось подключиться к серверу');
    joinBtn.removeAttribute('disabled');
    quickBtn.removeAttribute('disabled');
    return;
  }

  net.onMessage = (msg) => {
    if (msg.type === 'welcome') {
      setStatus('');
      showGameUI(true);
      if (msg.game === 'car') {
        game = new CarGame(net!, msg.playerId, msg.roomCode, msg.players);
        game.start();
      }
    } else if (msg.type === 'error') {
      setStatus(msg.message);
    } else if (msg.type === 'room_full') {
      setStatus('Комната заполнена');
    } else if (game) {
      game.handleServer(msg);
    }
  };

  net.onClose = () => {
    setStatus('Соединение потеряно');
    stopGame();
  };

  net.send({
    type: 'join',
    nick,
    code: quick ? undefined : code,
    quick,
    game: 'car' as GameId,
  });
}

function stopGame() {
  if (game) {
    game.destroy();
    game = null;
  }
  if (net) {
    net.close();
    net = null;
  }
  showGameUI(false);
  joinBtn.removeAttribute('disabled');
  quickBtn.removeAttribute('disabled');
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
