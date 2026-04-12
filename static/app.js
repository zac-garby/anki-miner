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
    ankiSync();
  } catch(e) {
    setStatus('not connected', 'error');
  }
}

async function ankiSync() {
  const btn = document.getElementById('syncBtn');
  if (btn) { btn.textContent = 'syncing…'; btn.disabled = true; }
  try {
    await anki('sync');
    if (btn) { btn.textContent = 'sync'; btn.disabled = false; }
    showToast('Synced with AnkiWeb');
  } catch(e) {
    if (btn) { btn.textContent = 'sync'; btn.disabled = false; }
    showToast('Sync failed: ' + e.message, true);
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

// ── Shared deck select ───────────────────────────────────────
async function populateDeckSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = sel.value;
  try {
    const names = await anki('deckNames');
    names.sort();
    sel.innerHTML = '';
    names.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === 'Norsk::Sentences') opt.selected = true;
      else if (prev && name === prev) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch { /* Anki not connected */ }
}

// ── Shared breakdown analysis ─────────────────────────────────
async function callBreakdownAnalysis(sentence, word = null) {
  const wordLine = word
    ? `Difficult word/phrase: "${word}"\n\nInclude "${word}" as one of the breakdown items (use the closest match if it appears differently in the sentence). The entirety of "${word}" should be a single breakdown item.`
    : 'No specific word provided — break down the whole sentence and highlight any words or phrases a B1 learner might find tricky.';

  const prompt = `You are helping a Norwegian language learner with sentence mining.

Sentence: "${sentence}"
${wordLine}

Please provide:
1. A natural English translation of the full sentence.
2. A breakdown of the sentence into meaningful parts. Each part should be a single word, a set phrase, or a notable grammatical construction. For each part give:
   - "text": the word or phrase as it appears in the sentence
   - "meaning": a brief explanation. For verbs, always identify the correct infinitive form (å + verb) — be careful with irregular past participles and forms that resemble other verbs (e.g. "spydd" is from "å spy", not "å spytte"). Prefer a Norwegian synonym or simple Norwegian definition if a B1 Norwegian learner would understand it; otherwise use an English gloss. Keep it brief (a word or short phrase). Do NOT repeat the word itself as the meaning.

Respond in this exact JSON format with no other text:
{
  "translation": "...",
  "breakdown": [
    {"text": "...", "meaning": "..."},
    {"text": "...", "meaning": "..."}
  ]
}`;

  const resp = await fetch('/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  const text = data.content?.[0]?.text || '{}';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

// ── ordbokene.no verification ────────────────────────────────
async function verifyAndCorrectBreakdown(sentence, breakdown) {
  // Batch-lookup all words in parallel
  const lookups = await Promise.all(
    breakdown.map(item =>
      fetch('/lookup-word?w=' + encodeURIComponent(item.text))
        .then(r => r.json())
        .catch(() => ({ found: false }))
    )
  );

  // Format dictionary data for Claude
  const dictLines = lookups.map((result, i) => {
    if (!result.found || !result.lemmas?.length) return null;
    const item = breakdown[i];
    const lemmaStr = result.lemmas.map(l => {
      let s = `"${l.lemma}" (${l.pos || l.class}`;
      if (l.form_tags?.length) s += ', ' + l.form_tags.join('/');
      s += ')';
      return s;
    }).join(', ');
    return `"${item.text}" → ${lemmaStr}`;
  }).filter(Boolean);

  if (!dictLines.length) return breakdown;

  const prompt =
`You provided this word-by-word breakdown for the Norwegian sentence "${sentence}":
${JSON.stringify(breakdown)}

Here is what the Norwegian dictionary (ordbokene.no) says about each word:
${dictLines.join('\n')}

Check each entry. Correct any errors — especially wrong verb infinitives (use exactly å + the lemma the dictionary gives). If everything is correct, return it unchanged. Return ONLY valid JSON:
{"breakdown": [{"text": "...", "meaning": "..."}]}`;

  try {
    const resp = await fetch('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 768,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return parsed.breakdown || breakdown;
  } catch {
    return breakdown;
  }
}

// ── Tab switching ─────────────────────────────────────────────
const TABS = ['mine', 'chat', 'media', 'translate'];

function switchTab(tab, pushState = true) {
  document.getElementById('deckSection').style.display = tab === 'browse' ? '' : 'none';
  document.getElementById('cardsSection').style.display = tab === 'browse' && currentDeck ? 'block' : 'none';
  document.getElementById('miningSection').style.display = tab === 'mine' ? 'block' : 'none';
  document.getElementById('chatSection').style.display = tab === 'chat' ? 'block' : 'none';
  document.getElementById('mediaSection').style.display = tab === 'media' ? 'block' : 'none';
  document.getElementById('translateSection').style.display = tab === 'translate' ? 'block' : 'none';
  TABS.forEach(t => document.getElementById('tab-' + t).classList.toggle('active', t === tab));
  if (tab === 'mine') populateMineDeckSelect();
  if (tab === 'chat') chatInitTab();
  if (tab === 'media') mediaInitTab();
  if (tab === 'translate') translateOnShow();
  if (pushState) location.hash = tab;
}

window.addEventListener('hashchange', () => {
  const tab = location.hash.replace('#', '');
  if (TABS.includes(tab)) switchTab(tab, false);
});

init();
