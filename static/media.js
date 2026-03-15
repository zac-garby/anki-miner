// ── Media Mining tab ─────────────────────────────────────────
// Navigate to tab from URL hash on load (runs last, after all scripts are loaded)
(function() {
  const tab = location.hash.replace('#', '');
  if (TABS.includes(tab) && tab !== 'browse') switchTab(tab, false);
})();

function mediaInitTab() {
  populateDeckSelect('mediaDeckSelect');
}

async function mediaFetchUrl() {
  const url = document.getElementById('mediaUrl').value.trim();
  if (!url) { showToast('Please enter a URL', true); return; }
  mediaSetStatus('Fetching subtitles…');
  try {
    const resp = await fetch('/fetch-subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error + (data.detail ? '\n\n' + data.detail : ''));
    if (!data.sentences?.length) throw new Error('No sentences found in subtitles');
    mediaSetStatus(null);
    mediaRenderAll(data.sentences);
  } catch(e) {
    mediaSetStatus(null);
    showToast('Error: ' + e.message, true);
  }
}

async function mediaUploadFile() {
  const file = document.getElementById('mediaFile').files[0];
  if (!file) return;
  mediaSetStatus('Reading file…');
  const form = new FormData();
  form.append('file', file);
  try {
    const resp = await fetch('/upload-subtitles', { method: 'POST', body: form });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    if (!data.sentences?.length) throw new Error('No sentences found in file');
    mediaSetStatus(null);
    mediaRenderAll(data.sentences);
  } catch(e) {
    mediaSetStatus(null);
    showToast('Error: ' + e.message, true);
  }
}

function mediaSetStatus(msg) {
  const el = document.getElementById('mediaStatus');
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function mediaRenderAll(sentences) {
  const container = document.getElementById('mediaResults');
  container.innerHTML = '';
  sentences.forEach(sentence => {
    const row = document.createElement('div');
    row.className = 'media-row';

    const sentenceEl = document.createElement('div');
    sentenceEl.className = 'media-sentence media-sentence-clickable';
    sentenceEl.textContent = sentence;
    sentenceEl.title = 'Click to analyse';
    sentenceEl.onclick = () => mediaAnalyseSentence(row, sentence, sentenceEl);
    row.appendChild(sentenceEl);

    container.appendChild(row);
  });
}

async function mediaAnalyseSentence(row, sentence, sentenceEl) {
  sentenceEl.onclick = null;
  sentenceEl.classList.remove('media-sentence-clickable');
  sentenceEl.classList.add('media-sentence-analysing');

  try {
    const result = await callBreakdownAnalysis(sentence);

    sentenceEl.classList.remove('media-sentence-analysing');
    sentenceEl.classList.add('media-sentence-verifying');

    result.breakdown = await verifyAndCorrectBreakdown(sentence, result.breakdown || []);

    sentenceEl.classList.remove('media-sentence-verifying');
    mediaExpandRow(row, sentence, result);
  } catch(e) {
    sentenceEl.classList.remove('media-sentence-analysing', 'media-sentence-verifying');
    sentenceEl.classList.add('media-sentence-clickable');
    sentenceEl.onclick = () => mediaAnalyseSentence(row, sentence, sentenceEl);
    showToast('Analysis failed: ' + e.message, true);
  }
}


function mediaExpandRow(row, sentence, result) {
  // Translation
  const transl = document.createElement('div');
  transl.className = 'media-translation';
  transl.textContent = result.translation || '';
  row.appendChild(transl);

  // Breakdown chips
  const breakdown = document.createElement('div');
  breakdown.className = 'media-breakdown';
  let selectedIdx = -1;

  // Actions row
  const actions = document.createElement('div');
  actions.className = 'media-actions';

  const clozePreview = document.createElement('code');
  clozePreview.className = 'cloze-preview media-cloze-preview';
  clozePreview.textContent = 'select a word to generate cloze';
  clozePreview.style.color = 'rgb(160,155,145)';

  const mineBtn = document.createElement('button');
  mineBtn.textContent = 'Save mining card';
  mineBtn.disabled = true;

  const clozeBtn = document.createElement('button');
  clozeBtn.textContent = 'Save cloze card';
  clozeBtn.disabled = true;

  let currentCloze = '';

  function onChipSelect(idx) {
    breakdown.querySelectorAll('.breakdown-item').forEach((el, i) =>
      el.classList.toggle('selected', i === idx));
    selectedIdx = idx;
    const item = (result.breakdown || [])[idx];
    if (!item) return;

    // Build cloze: replace the phrase in the sentence with {{c1::text::meaning}}
    currentCloze = sentence.replace(item.text, `{{c1::${item.text}::${item.meaning}}}`);
    clozePreview.textContent = currentCloze;
    clozePreview.style.color = '';
    mineBtn.disabled = false;
    clozeBtn.disabled = false;
  }

  mineBtn.onclick = async () => {
    const item = (result.breakdown || [])[selectedIdx];
    if (!item) return;
    const deck = document.getElementById('mediaDeckSelect').value || 'Norsk::Sentences';
    try {
      await anki('addNote', { note: {
        deckName: deck,
        modelName: 'Sentence mining',
        fields: { 'Front': sentence, 'Word (no)': item.text, 'Word (en)': item.meaning, 'Audio': '' },
        tags: ['mined', 'media']
      }});
      mineBtn.textContent = 'Saved';
      mineBtn.disabled = true;
      showToast('Mining card saved!');
      ankiSync();
    } catch(e) { showToast('Error: ' + e.message, true); }
  };

  clozeBtn.onclick = async () => {
    if (!currentCloze) return;
    const deck = document.getElementById('mediaDeckSelect').value || 'Norsk::Sentences';
    try {
      await anki('addNote', { note: {
        deckName: deck,
        modelName: 'Cloze',
        fields: { Text: currentCloze },
        tags: ['mined', 'media']
      }});
      clozeBtn.textContent = 'Saved';
      clozeBtn.disabled = true;
      showToast('Cloze card saved!');
      ankiSync();
    } catch(e) { showToast('Error: ' + e.message, true); }
  };

  // Render breakdown chips
  (result.breakdown || []).forEach((item, idx) => {
    const chip = document.createElement('div');
    chip.className = 'breakdown-item';
    chip.innerHTML = `<span class="breakdown-word">${esc(item.text)}</span><span class="breakdown-meaning">${esc(item.meaning)}</span>`;
    chip.onclick = () => onChipSelect(idx);
    breakdown.appendChild(chip);
  });

  actions.appendChild(clozePreview);
  actions.appendChild(mineBtn);
  actions.appendChild(clozeBtn);

  row.appendChild(breakdown);
  row.appendChild(actions);
}
