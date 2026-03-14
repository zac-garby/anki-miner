const ANKI = 'https://box.zacgarby.co.uk:8765';
const PAGE_SIZE = 50;

// Browse globals
let allNotes = [];
let filteredNotes = [];
let currentPage = 1;
let currentDeck = null;
let selectedIds = new Set();
let editingNoteId = null;
let isAdding = false;
let collectionEpoch = null;

// Mining globals
let breakdownData = [];

// Chat globals
let chatConversations = [];
let chatCurrentId = null;

// AnkiConnect key (persisted in cookie)
let ankiKey = getCookie('ankiKey') || '';

function getCookie(name) {
  const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
  return m ? decodeURIComponent(m[1]) : '';
}

function setCookie(name, value, days) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + exp + ';path=/';
}

async function anki(action, params = {}) {
  const body = { action, version: 6, params };
  if (ankiKey) body.key = ankiKey;
  const r = await fetch(ANKI, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  return d.result;
}

async function init() {
  setStatus('connecting…', '');
  try {
    // Check permission / key requirement
    const permBody = { action: 'requestPermission', version: 6 };
    if (ankiKey) permBody.key = ankiKey;
    const permResp = await fetch(ANKI, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(permBody)
    });
    const permData = await permResp.json();
    if (permData.result?.permission === 'denied') {
      promptAnkiKey('AnkiConnect requires an API key:');
      return;
    }

    await anki('version');
    setStatus('connected', 'connected');
    loadDecks();
  } catch(e) {
    setStatus('not connected', 'error');
  }
}

function promptAnkiKey(msg) {
  showAnkiKeyModal(msg);
}

function showAnkiKeyModal(msg) {
  document.getElementById('ankiKeyMsg').textContent = msg || 'Enter AnkiConnect API key:';
  document.getElementById('ankiKeyInput').value = ankiKey;
  document.getElementById('ankiKeyModal').style.display = 'flex';
  document.getElementById('ankiKeyInput').focus();
}

function hideAnkiKeyModal() {
  document.getElementById('ankiKeyModal').style.display = 'none';
}

function saveAnkiKey() {
  const val = document.getElementById('ankiKeyInput').value.trim();
  ankiKey = val;
  setCookie('ankiKey', val, 365);
  hideAnkiKeyModal();
  init();
}

function setStatus(msg, cls) {
  const el = document.getElementById('statusText');
  el.textContent = msg;
  el.className = 'status ' + cls;
}

function stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || d.innerText || ''; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showToast(msg, isError=false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = 'toast', 2800);
}

// ── Tab switching ─────────────────────────────────────────────
const TABS = ['browse', 'mine', 'chat', 'media'];

function switchTab(tab, pushState = true) {
  document.getElementById('deckSection').style.display = tab === 'browse' ? '' : 'none';
  document.getElementById('cardsSection').style.display = tab === 'browse' && currentDeck ? 'block' : 'none';
  document.getElementById('miningSection').style.display = tab === 'mine' ? 'block' : 'none';
  document.getElementById('chatSection').style.display = tab === 'chat' ? 'block' : 'none';
  document.getElementById('mediaSection').style.display = tab === 'media' ? 'block' : 'none';
  TABS.forEach(t => document.getElementById('tab-' + t).classList.toggle('active', t === tab));
  if (tab === 'mine') populateMineDeckSelect();
  if (tab === 'chat') chatInitTab();
  if (tab === 'media') mediaInitTab();
  if (pushState) location.hash = tab;
}

window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#', '');
  if (TABS.includes(tab)) switchTab(tab, false);
});

init();
