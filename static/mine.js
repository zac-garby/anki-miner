// ── Sentence Mining tab ───────────────────────────────────────

function populateMineDeckSelect() {
  populateDeckSelect('mineDeckSelect');
}

let selectedBreakdownIdxs = new Set();

function selectBreakdownItem(idx) {
  if (selectedBreakdownIdxs.has(idx)) {
    selectedBreakdownIdxs.delete(idx);
  } else {
    selectedBreakdownIdxs.add(idx);
  }
  document.querySelectorAll('.breakdown-item').forEach((el, i) => {
    el.classList.toggle('selected', selectedBreakdownIdxs.has(i));
  });
  updateMineClozePrev();
}

function updateMineClozePrev() {
  const sentence = document.getElementById('mineSentence').value.replace(/\{([^}]+)\}/g, '$1').trim();
  const sorted = [...selectedBreakdownIdxs].sort((a, b) => a - b);

  const meanings = sorted.map(idx => breakdownData[idx]?.meaning).filter(Boolean);
  document.getElementById('mineMeaning').textContent = meanings.join('; ');

  if (!sorted.length) {
    document.getElementById('mineClozePreview').value = '';
    return;
  }

  // Replace each selected item in sentence order; track replacements so indices stay valid
  // Build list of (position, text, meaning, cN)
  const items = sorted.map((idx, i) => ({ item: breakdownData[idx], cN: `c${i + 1}` })).filter(d => d.item);

  // Sort by position in sentence to replace from right-to-left (avoids offset drift)
  const withPos = items.map(({ item, cN }) => {
    const pos = sentence.indexOf(item.text);
    return { pos, item, cN };
  }).filter(d => d.pos !== -1).sort((a, b) => b.pos - a.pos);

  let result = sentence;
  for (const { item, cN } of withPos) {
    const rawHint = item.hint || item.meaning;
    const safeHint = rawHint.replace(new RegExp(item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '').replace(/\s{2,}/g, ' ').trim();
    result = result.replace(item.text, `{{${cN}::${item.text}::${safeHint}}}`);
  }

  document.getElementById('mineClozePreview').value = result;
}

function renderBreakdown(breakdown, inputWord) {
  breakdownData = breakdown;
  selectedBreakdownIdxs = new Set();
  const container = document.getElementById('mineBreakdown');
  container.innerHTML = '';
  breakdown.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'breakdown-item';
    el.innerHTML = `<span class="breakdown-word">${esc(item.text)}</span><span class="breakdown-meaning">${esc(item.meaning)}</span>`;
    el.onclick = () => selectBreakdownItem(idx);
    container.appendChild(el);
  });
  if (inputWord) {
    const matchIdx = breakdown.findIndex(item =>
      item.text.toLowerCase() === inputWord.toLowerCase() ||
      item.text.toLowerCase().includes(inputWord.toLowerCase()) ||
      inputWord.toLowerCase().includes(item.text.toLowerCase())
    );
    if (matchIdx >= 0) selectBreakdownItem(matchIdx);
  }
}

async function runMining() {
  const rawSentence = document.getElementById('mineSentence').value.trim();
  const word = document.getElementById('mineWord').value.trim();
  if (!rawSentence) { showToast('Please enter a sentence', true); return; }

  // Parse brace-delimited forced chunks
  const forcedChunks = [...rawSentence.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  const sentence = rawSentence.replace(/\{([^}]+)\}/g, '$1');

  document.getElementById('mineThinking').style.display = 'inline';
  document.getElementById('mineResult').classList.remove('visible');

  try {
    const parsed = await callBreakdownAnalysis(sentence, word || null, forcedChunks);

    document.getElementById('mineThinking').textContent = 'verifying…';
    const breakdown = await verifyAndCorrectBreakdown(sentence, parsed.breakdown);

    document.getElementById('mineTranslation').textContent = parsed.translation;
    renderBreakdown(breakdown, word);
    document.getElementById('mineClozePreview').value = '';
    document.getElementById('mineMeaning').textContent = '';
    document.getElementById('mineResult').classList.add('visible');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  } finally {
    const t = document.getElementById('mineThinking');
    t.style.display = 'none';
    t.textContent = 'thinking…';
  }
}

async function saveMiningClozeCard() {
  const clozeText = document.getElementById('mineClozePreview').value.trim();
  const deck = document.getElementById('mineDeckSelect').value;

  if (!deck) { showToast('Please select a deck', true); return; }
  if (!clozeText) { showToast('Please select a word from the breakdown first', true); return; }

  try {
    await anki('addNote', {note: {
      deckName: deck,
      modelName: 'Cloze',
      fields: { 'Text': clozeText },
      tags: ['mined']
    }});
    showToast('Cloze card saved!');
    ankiSync();
  } catch(e) {
    showToast('Error saving: ' + e.message, true);
  }
}

async function saveMiningCard() {
  const rawSentence = document.getElementById('mineSentence').value.trim();
  const sentence = rawSentence.replace(/\{([^}]+)\}/g, '$1');
  const word = document.getElementById('mineWord').value.trim();
  const meaning = document.getElementById('mineMeaning').textContent.trim();
  const deck = document.getElementById('mineDeckSelect').value;

  if (!deck) { showToast('Please select a deck', true); return; }
  if (!word && !selectedBreakdownIdxs.size) { showToast('Please select a word from the breakdown first', true); return; }
  if (selectedBreakdownIdxs.size > 1) { showToast('Select only one word for a mining card — or use "Save as cloze" for multiple', true); return; }

  const selectedIdx = [...selectedBreakdownIdxs][0];
  const selectedWord = word || breakdownData[selectedIdx]?.text || '';
  const selectedMeaning = meaning || breakdownData[selectedIdx]?.meaning || '';

  try {
    await anki('addNote', {note: {
      deckName: deck,
      modelName: 'Sentence mining',
      fields: {
        'Front': sentence,
        'Word (no)': selectedWord,
        'Word (en)': selectedMeaning,
        'Audio': ''
      },
      tags: ['mined']
    }});
    showToast('Card saved!');
    ankiSync();
  } catch(e) {
    showToast('Error saving: ' + e.message, true);
  }
}
