// ── Translate tab ──────────────────────────────────────────────

const TRANSLATE_LANGS = [
  { label: 'Norwegian (Bokmål)',    value: 'Norwegian (Bokmål)',    hint: null },
  { label: 'Norwegian (Nynorsk)',   value: 'Norwegian (Nynorsk)',   hint: null },
  { label: 'English',               value: 'English',               hint: null },
  { label: 'Swedish',               value: 'Swedish',               hint: null },
  { label: 'Danish',                value: 'Danish',                hint: null },
  { label: 'German',                value: 'German',                hint: null },
  { label: 'French',                value: 'French',                hint: null },
  { label: 'Spanish',               value: 'Spanish',               hint: null },
  { label: 'Italian',               value: 'Italian',               hint: null },
  { label: 'Portuguese',            value: 'Portuguese',            hint: null },
  { label: 'Polish',                value: 'Polish',                hint: null },
  { label: 'Dutch',                 value: 'Dutch',                 hint: null },
  { label: 'Finnish',               value: 'Finnish',               hint: null },
  { label: 'Russian',               value: 'Russian',               hint: null },
  { label: 'Japanese',              value: 'Japanese',              hint: null },
  { label: 'Chinese (Simplified)',  value: 'Chinese (Simplified)',  hint: null },
  { label: 'Korean',                value: 'Korean',                hint: null },
  { label: 'Arabic',                value: 'Arabic',                hint: null },
  { label: 'Turkish',               value: 'Turkish',               hint: null },
  {
    label: 'Pirate Speak',
    value: 'Pirate Speak',
    hint: 'Translate in stereotypical pirate dialect: use "arrr", "ye", "matey", "landlubber", drop g\'s ("sailin\'"), etc. Example: "I want to go home" → "Arrr, I be wantin\' to sail back to me homeport, matey!"',
  },
  {
    label: 'LinkedIn Lingo',
    value: 'LinkedIn Lingo',
    hint: 'Translate in the style of enthusiastic LinkedIn posts: buzzwords ("synergy", "leverage", "thought leader", "circle back", "move the needle"), excessive positivity, humble-bragging, emojis. Example: "I got a promotion" → "Thrilled to announce I\'m levelling up my impact journey! 🚀 Grateful for this opportunity to add value."',
  },
  {
    label: 'Caveman',
    value: 'Caveman',
    hint: 'Translate as a caveman speaks: very short sentences, no articles or prepositions, present tense only, simple nouns and verbs, occasional "UGH" or "OOGA". Example: "I would like some food please" → "UGH. Me want food. Give now."',
  },
  { label: 'Other…', value: '__other__', hint: null },
];

let translateInited = false;
let translateDebounceTimer = null;
let translateAbortCtrl = null;
let translateState = { sentences: [] };

// ── Init ───────────────────────────────────────────────────────

function translateOnShow() {
  if (translateInited) return;
  translateInited = true;

  const savedPrefs = _translateLoadPrefs();
  _translatePopulateLangs('translateFromLang', savedPrefs.fromLang || 'Norwegian (Bokmål)');
  _translatePopulateLangs('translateToLang',   savedPrefs.toLang   || 'English');
  if (savedPrefs.fromCustom) {
    document.getElementById('translateFromCustom').value = savedPrefs.fromCustom;
    _translateHandleLangChange('translateFromLang', 'translateFromCustom');
  }
  if (savedPrefs.toCustom) {
    document.getElementById('translateToCustom').value = savedPrefs.toCustom;
    _translateHandleLangChange('translateToLang', 'translateToCustom');
  }

  document.getElementById('translateFromLang').addEventListener('change', () => {
    _translateHandleLangChange('translateFromLang', 'translateFromCustom');
    _translateSavePrefs();
    _translateMaybeRetranslate();
  });
  document.getElementById('translateToLang').addEventListener('change', () => {
    _translateHandleLangChange('translateToLang', 'translateToCustom');
    _translateSavePrefs();
    _translateMaybeRetranslate();
  });
  document.getElementById('translateFromCustom').addEventListener('input', () => { _translateSavePrefs(); _translateMaybeRetranslate(); });
  document.getElementById('translateToCustom').addEventListener('input', () => { _translateSavePrefs(); _translateMaybeRetranslate(); });

  document.getElementById('translateSource').addEventListener('input', () => {
    _translateUpdatePasteBtn();
    clearTimeout(translateDebounceTimer);
    translateDebounceTimer = setTimeout(runTranslation, 1200);
  });

  _translateUpdatePasteBtn();

  document.addEventListener('click', e => {
    if (!e.target.closest('#translateOutput')) translateCloseAlts();
  });

  translateRenderHistory();
}

function _translatePopulateLangs(selectId, defaultValue) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = '';
  TRANSLATE_LANGS.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.value;
    opt.textContent = lang.label;
    if (lang.value === defaultValue) opt.selected = true;
    sel.appendChild(opt);
  });
}

function _translateHandleLangChange(selectId, customId) {
  const sel = document.getElementById(selectId);
  document.getElementById(customId).style.display = sel.value === '__other__' ? '' : 'none';
}

function _translateMaybeRetranslate() {
  const src = document.getElementById('translateSource').value.trim();
  if (src) {
    clearTimeout(translateDebounceTimer);
    translateDebounceTimer = setTimeout(runTranslation, 300);
  }
}

// ── Language helpers ───────────────────────────────────────────

function translateGetLang(selectId, customId) {
  const sel = document.getElementById(selectId);
  if (sel.value === '__other__') {
    return document.getElementById(customId).value.trim() || 'Unknown';
  }
  return sel.value;
}

function translateGetHint(selectId) {
  const sel = document.getElementById(selectId);
  const entry = TRANSLATE_LANGS.find(l => l.value === sel.value);
  return entry?.hint || null;
}

function translateLangLabel(selectId, customId) {
  const name = translateGetLang(selectId, customId);
  const hint = translateGetHint(selectId);
  return hint ? `${name} (Style note: ${hint})` : name;
}

// ── API call ───────────────────────────────────────────────────

async function runTranslation() {
  const sourceEl = document.getElementById('translateSource');
  const src = sourceEl.value.trim();
  if (!src) {
    document.getElementById('translateOutput').innerHTML = '<span id="translateThinking" style="display:none" class="thinking">translating…</span>';
    translateState.sentences = [];
    return;
  }

  const fromLabel = translateLangLabel('translateFromLang', 'translateFromCustom');
  const toLabel   = translateLangLabel('translateToLang',   'translateToCustom');
  const singleWord = src.split(/\s+/).length === 1;

  if (translateAbortCtrl) translateAbortCtrl.abort();
  translateAbortCtrl = new AbortController();

  const thinkingEl = document.getElementById('translateThinking') || (() => {
    const s = document.createElement('span');
    s.id = 'translateThinking';
    s.className = 'thinking';
    return s;
  })();
  document.getElementById('translateOutput').innerHTML = '';
  document.getElementById('translateOutput').appendChild(thinkingEl);
  thinkingEl.style.display = 'inline';
  thinkingEl.textContent = 'translating…';

  const prompt = singleWord ? _translateSingleWordPrompt(src, fromLabel, toLabel)
                             : _translateMultiPrompt(src, fromLabel, toLabel);

  console.log("prompting with: ", prompt)

  try {
    const resp = await fetch('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: translateAbortCtrl.signal,
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.[0]?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const sentences = (parsed.sentences || []).map(s => ({ ...s, activeIdx: 0 }));
    translateState.sentences = sentences;
    translateRenderOutput();
    translateSave(translateGetLang('translateFromLang', 'translateFromCustom'),
                  translateGetLang('translateToLang',   'translateToCustom'),
                  src, sentences);
  } catch (e) {
    if (e.name === 'AbortError') return;
    thinkingEl.style.display = 'none';
    showToast('Translation error: ' + e.message, true);
  }
}

function _translateMultiPrompt(src, fromLabel, toLabel) {
  return `Translate the following text from ${fromLabel} to ${toLabel}.
Return JSON only — no markdown, no prose:
{
  "sentences": [
    {
      "original": "<source sentence>",
      "translation": "<primary translation>",
      "alternatives": [
        { "text": "<alt>", "explanation": "<brief English nuance note>" }
      ]
    }
  ]
}
Rules:
- Translate as a whole for context, then split output by sentence.
- Include ALL plausible alternatives including near-identical variants (different word order, synonyms, etc.). Each must be grammatically correct.
- For each alternative, give a short English explanation of the nuance or difference.
- Return 0–4 alternatives per sentence.

Text to translate:
${src}`;
}

function _translateSingleWordPrompt(word, fromLabel, toLabel) {
  return `Translate the word "${word}" from ${fromLabel} to ${toLabel}.
Return JSON only — no markdown, no prose, with ALL plausible translations/meanings:
{
  "sentences": [
    {
      "original": "${word}",
      "translation": "<primary translation>",
      "pos": "<noun|verb|adjective|other>",
      "grammar": {},
      "alternatives": [
        {
          "text": "<alt translation>",
          "explanation": "<nuance note>",
          "pos": "<noun|verb|adjective|other>",
          "grammar": {}
        }
      ]
    }
  ]
}
Grammar object rules — only include fields that are meaningful for the TARGET language (${toLabel}):
- noun:      { "gender": "masculine|feminine|neuter|common" }  — omit entirely if target language has no grammatical gender
- verb:      { "infinitive": "…", "present": "…", "past": "…", "future": "…", "past_participle": "…" }
- adjective: { "masculine": "…", "feminine": "…", "neuter": "…" }  — omit forms that don't exist in the target language
- other:     {}
Return 0–4 alternatives.`;
}

// ── Rendering ──────────────────────────────────────────────────

function translateRenderOutput() {
  const out = document.getElementById('translateOutput');
  out.innerHTML = '';

  // Prose paragraph with inline sentence spans
  const prose = document.createElement('p');
  prose.className = 'translate-prose';

  translateState.sentences.forEach((sent, idx) => {
    if (idx > 0) prose.appendChild(document.createTextNode(' '));
    const span = document.createElement('span');
    span.className = 'translate-sent-text' + (sent.alternatives?.length ? ' has-alts' : '');
    span.dataset.idx = idx;
    span.textContent = _translateActiveText(sent);
    span.onclick = e => { e.stopPropagation(); translateToggleAlts(idx); };
    prose.appendChild(span);
  });

  out.appendChild(prose);

  // Grammar block (single-word mode — shown below prose)
  const firstSent = translateState.sentences[0];
  if (firstSent) {
    const g = _translateRenderGrammar(_translateActiveGrammar(firstSent), _translateActivePOS(firstSent));
    if (g) out.appendChild(g);
  }

  // Single shared detail panel
  const panel = document.createElement('div');
  panel.id = 'translate-detail-panel';
  panel.className = 'translate-detail-panel';
  panel.style.display = 'none';
  out.appendChild(panel);
}

function _translateActiveText(sent) {
  if (sent.activeIdx === 0) return sent.translation;
  return sent.alternatives[sent.activeIdx - 1].text;
}

function _translateActiveGrammar(sent) {
  if (sent.activeIdx === 0) return sent.grammar || null;
  const alt = sent.alternatives[sent.activeIdx - 1];
  return alt.grammar || null;
}

function _translateActivePOS(sent) {
  if (sent.activeIdx === 0) return sent.pos || null;
  return sent.alternatives[sent.activeIdx - 1].pos || null;
}

function _translateRenderGrammar(grammar, pos) {
  if (!grammar || !pos) return null;
  const entries = [];
  if (pos === 'noun' && grammar.gender) {
    entries.push(`Gender: ${grammar.gender}`);
  } else if (pos === 'verb') {
    const fields = [
      grammar.infinitive   && `inf. ${grammar.infinitive}`,
      grammar.present      && `pres. ${grammar.present}`,
      grammar.past         && `past ${grammar.past}`,
      grammar.future       && `fut. ${grammar.future}`,
      grammar.past_participle && `p.p. ${grammar.past_participle}`,
    ].filter(Boolean);
    entries.push(...fields);
  } else if (pos === 'adjective') {
    const forms = [
      grammar.masculine && `masc. ${grammar.masculine}`,
      grammar.feminine  && `fem. ${grammar.feminine}`,
      grammar.neuter    && `neut. ${grammar.neuter}`,
    ].filter(Boolean);
    entries.push(...forms);
  }
  if (!entries.length) return null;
  const el = document.createElement('div');
  el.className = 'translate-grammar';
  el.textContent = entries.join(' · ');
  return el;
}

// ── Alternatives interaction ───────────────────────────────────

function translateToggleAlts(idx) {
  const panel = document.getElementById('translate-detail-panel');
  const sent = translateState.sentences[idx];
  if (!panel || !sent) return;

  const isOpen = panel.style.display !== 'none' && panel.dataset.sentIdx === String(idx);
  if (isOpen) {
    translateCloseAlts();
    return;
  }

  panel.dataset.sentIdx = idx;
  _translateRenderDetailPanel(panel, sent, idx);
  panel.style.display = '';

  document.querySelectorAll('.translate-sent-text').forEach(s => s.classList.remove('active'));
  document.querySelector(`.translate-sent-text[data-idx="${idx}"]`)?.classList.add('active');
}

function _translateRenderDetailPanel(panel, sent, idx) {
  panel.innerHTML = '';

  // Grammar (single-word mode)
  const g = _translateRenderGrammar(_translateActiveGrammar(sent), _translateActivePOS(sent));
  if (g) panel.appendChild(g);

  // Primary translation (always first)
  const primaryItem = document.createElement('div');
  primaryItem.className = 'translate-alt-item' + (sent.activeIdx === 0 ? ' selected' : '');
  primaryItem.onclick = e => { e.stopPropagation(); translateSelectAlt(idx, -1); };
  const primaryText = document.createElement('span');
  primaryText.className = 'translate-alt-text';
  primaryText.textContent = sent.translation;
  primaryItem.appendChild(primaryText);
  const primaryLabel = document.createElement('span');
  primaryLabel.className = 'translate-alt-explanation';
  primaryLabel.textContent = 'original translation';
  primaryItem.appendChild(primaryLabel);
  panel.appendChild(primaryItem);

  // Alternatives
  if (sent.alternatives?.length) {
    sent.alternatives.forEach((alt, altIdx) => {
      const item = document.createElement('div');
      item.className = 'translate-alt-item' + (sent.activeIdx === altIdx + 1 ? ' selected' : '');
      item.onclick = e => { e.stopPropagation(); translateSelectAlt(idx, altIdx); };

      const altText = document.createElement('span');
      altText.className = 'translate-alt-text';
      altText.textContent = alt.text;
      item.appendChild(altText);

      if (sent.activeIdx === altIdx + 1) {
        const exp = document.createElement('span');
        exp.className = 'translate-alt-explanation';
        exp.textContent = alt.explanation;
        item.appendChild(exp);
      }
      panel.appendChild(item);
    });
  }

  // Footer: mine + done
  const footer = document.createElement('div');
  footer.className = 'translate-detail-footer';

  const mineBtn = document.createElement('button');
  mineBtn.className = 'status-btn';
  mineBtn.textContent = '→ Mine';
  mineBtn.onclick = e => { e.stopPropagation(); translateMine(idx); };
  footer.appendChild(mineBtn);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'status-btn';
  doneBtn.textContent = 'Done';
  doneBtn.onclick = e => { e.stopPropagation(); translateCloseAlts(); };
  footer.appendChild(doneBtn);

  panel.appendChild(footer);
}

function translateSelectAlt(sentIdx, altIdx) {
  const sent = translateState.sentences[sentIdx];
  if (!sent) return;

  // altIdx -1 = primary translation (activeIdx 0)
  const newActiveIdx = altIdx + 1;
  if (sent.activeIdx === newActiveIdx) {
    translateCloseAlts();
    return;
  }

  sent.activeIdx = newActiveIdx;

  // Update prose span
  const span = document.querySelector(`.translate-sent-text[data-idx="${sentIdx}"]`);
  if (span) span.textContent = _translateActiveText(sent);

  // Update grammar block below prose
  const out = document.getElementById('translateOutput');
  const oldGrammar = out.querySelector('.translate-grammar');
  if (oldGrammar) oldGrammar.remove();
  const newGrammar = _translateRenderGrammar(_translateActiveGrammar(sent), _translateActivePOS(sent));
  if (newGrammar) {
    const panel = document.getElementById('translate-detail-panel');
    out.insertBefore(newGrammar, panel);
  }

  // Re-render detail panel in place
  const panel = document.getElementById('translate-detail-panel');
  if (panel && panel.dataset.sentIdx === String(sentIdx)) {
    _translateRenderDetailPanel(panel, sent, sentIdx);
  }
}

function translateCloseAlts() {
  const panel = document.getElementById('translate-detail-panel');
  if (panel) { panel.style.display = 'none'; panel.dataset.sentIdx = ''; }
  document.querySelectorAll('.translate-sent-text').forEach(s => s.classList.remove('active'));
}

// ── Swap ───────────────────────────────────────────────────────

function translateSwap() {
  // Capture current values
  const fromVal    = document.getElementById('translateFromLang').value;
  const fromCustom = document.getElementById('translateFromCustom').value;
  const toVal      = document.getElementById('translateToLang').value;
  const toCustom   = document.getElementById('translateToCustom').value;

  // Build the new source text from current output (active translations joined)
  const currentOutput = translateState.sentences
    .map(s => _translateActiveText(s))
    .join(' ')
    .trim();
  const currentSource = document.getElementById('translateSource').value.trim();

  // Swap languages
  document.getElementById('translateFromLang').value = toVal;
  document.getElementById('translateFromCustom').value = toCustom;
  document.getElementById('translateToLang').value = fromVal;
  document.getElementById('translateToCustom').value = fromCustom;
  _translateHandleLangChange('translateFromLang', 'translateFromCustom');
  _translateHandleLangChange('translateToLang',   'translateToCustom');

  // Swap text: output becomes source, old source goes away
  document.getElementById('translateSource').value = currentOutput || currentSource;

  // Clear output and re-translate
  translateState.sentences = [];
  document.getElementById('translateOutput').innerHTML = '<span id="translateThinking" style="display:none" class="thinking">translating…</span>';
  clearTimeout(translateDebounceTimer);
  if (document.getElementById('translateSource').value.trim()) runTranslation();
}

// ── Mine integration ───────────────────────────────────────────

function translateMine(sentIdx) {
  const sent = translateState.sentences[sentIdx];
  if (!sent) return;
  translateCloseAlts();
  switchTab('mine');
  document.getElementById('mineSentence').value = _translateActiveText(sent);
  document.getElementById('mineWord').focus();
}

// ── Copy / Paste ───────────────────────────────────────────────

function translateCopy() {
  const text = translateState.sentences.map(s => _translateActiveText(s)).join(' ').trim();
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

async function translatePaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    const src = document.getElementById('translateSource');
    src.value = text;
    _translateUpdatePasteBtn();
    clearTimeout(translateDebounceTimer);
    translateDebounceTimer = setTimeout(runTranslation, 800);
  } catch {
    showToast('Could not read clipboard', true);
  }
}

function _translateUpdatePasteBtn() {
  const btn = document.getElementById('translatePasteBtn');
  if (btn) btn.style.display = document.getElementById('translateSource').value ? 'none' : '';
}

// ── History ────────────────────────────────────────────────────

function translateSave(fromLang, toLang, sourceText, sentences) {
  const history = translateLoadRaw();
  history.unshift({
    id: Date.now().toString(),
    fromLang,
    toLang,
    sourceText,
    sentences,
    timestamp: Date.now(),
  });
  if (history.length > 50) history.length = 50;
  localStorage.setItem('anki-translate', JSON.stringify(history));
  translateRenderHistory();
}

function _translateSavePrefs() {
  localStorage.setItem('anki-translate-prefs', JSON.stringify({
    fromLang:   document.getElementById('translateFromLang').value,
    fromCustom: document.getElementById('translateFromCustom').value,
    toLang:     document.getElementById('translateToLang').value,
    toCustom:   document.getElementById('translateToCustom').value,
  }));
}

function _translateLoadPrefs() {
  try { return JSON.parse(localStorage.getItem('anki-translate-prefs') || '{}'); }
  catch { return {}; }
}

function translateLoadRaw() {
  try { return JSON.parse(localStorage.getItem('anki-translate') || '[]'); }
  catch { return []; }
}

function translateRenderHistory() {
  const list = document.getElementById('translateHistoryList');
  if (!list) return;
  const history = translateLoadRaw();
  list.innerHTML = '';
  if (!history.length) {
    list.innerHTML = '<span class="muted" style="font-size:0.82em;padding:4px 6px;display:block">No history yet</span>';
    return;
  }

  const now = new Date();
  const todayStr   = _translateDateLabel(now);
  const yestStr    = _translateDateLabel(new Date(now - 864e5));

  let lastGroup = null;
  history.forEach(entry => {
    const dateStr = _translateDateLabel(new Date(entry.timestamp));
    const groupLabel = dateStr === todayStr ? 'Today' : dateStr === yestStr ? 'Yesterday' : dateStr;
    if (groupLabel !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'translate-hist-group';
      g.textContent = groupLabel;
      list.appendChild(g);
      lastGroup = groupLabel;
    }

    const item = document.createElement('div');
    item.className = 'translate-hist-item';
    const preview = entry.sourceText.slice(0, 48) + (entry.sourceText.length > 48 ? '…' : '');
    const langLine = entry.fromLang + ' → ' + entry.toLang;
    item.innerHTML = `<span class="translate-hist-preview">${esc(preview)}</span><span class="translate-hist-lang">${esc(langLine)}</span>`;
    item.onclick = () => translateRestoreEntry(entry);
    list.appendChild(item);
  });
}

function _translateDateLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function translateRestoreEntry(entry) {
  // Restore language selects
  _translateSetLang('translateFromLang', 'translateFromCustom', entry.fromLang);
  _translateSetLang('translateToLang',   'translateToCustom',   entry.toLang);

  // Restore source text
  document.getElementById('translateSource').value = entry.sourceText;

  // Restore output
  translateState.sentences = entry.sentences.map(s => ({ ...s, activeIdx: s.activeIdx || 0 }));
  translateRenderOutput();

  // Mark item active
  document.querySelectorAll('.translate-hist-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

function _translateSetLang(selectId, customId, langName) {
  const sel = document.getElementById(selectId);
  const match = TRANSLATE_LANGS.find(l => l.value === langName);
  if (match) {
    sel.value = match.value;
    document.getElementById(customId).style.display = 'none';
  } else {
    sel.value = '__other__';
    document.getElementById(customId).style.display = '';
    document.getElementById(customId).value = langName;
  }
}

// Handle initial page load when hash is already #translate
const _translateInitialTab = location.hash.replace('#', '');
if (_translateInitialTab === 'translate') switchTab('translate', false);
