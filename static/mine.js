// ── Sentence Mining tab ───────────────────────────────────────

function populateMineDeckSelect() {
  populateDeckSelect('mineDeckSelect');
}

function selectBreakdownItem(idx) {
  document.querySelectorAll('.breakdown-item').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
  const item = breakdownData[idx];
  if (item) {
    document.getElementById('mineWord').value = item.text;
    document.getElementById('mineMeaning').textContent = item.meaning;
  }
}

function renderBreakdown(breakdown, inputWord) {
  breakdownData = breakdown;
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
    selectBreakdownItem(matchIdx >= 0 ? matchIdx : 0);
  }
}

async function runMining() {
  const sentence = document.getElementById('mineSentence').value.trim();
  const word = document.getElementById('mineWord').value.trim();
  if (!sentence) { showToast('Please enter a sentence', true); return; }

  document.getElementById('mineThinking').style.display = 'inline';
  document.getElementById('mineResult').classList.remove('visible');

  try {
    const parsed = await callBreakdownAnalysis(sentence, word || null);

    document.getElementById('mineThinking').textContent = 'verifying…';
    const breakdown = await verifyAndCorrectBreakdown(sentence, parsed.breakdown);

    document.getElementById('mineTranslation').textContent = parsed.translation;
    renderBreakdown(breakdown, word);
    document.getElementById('mineResult').classList.add('visible');
  } catch(e) {
    showToast('Error: ' + e.message, true);
  } finally {
    const t = document.getElementById('mineThinking');
    t.style.display = 'none';
    t.textContent = 'thinking…';
  }
}

async function saveMiningCard() {
  const sentence = document.getElementById('mineSentence').value.trim();
  const word = document.getElementById('mineWord').value.trim();
  const meaning = document.getElementById('mineMeaning').textContent.trim();
  const deck = document.getElementById('mineDeckSelect').value;

  if (!deck) { showToast('Please select a deck', true); return; }
  if (!word) { showToast('Please select a word from the breakdown first', true); return; }

  try {
    await anki('addNote', {note: {
      deckName: deck,
      modelName: 'Sentence mining',
      fields: {
        'Front': sentence,
        'Word (no)': word,
        'Word (en)': meaning,
        'Audio': ''
      },
      tags: ['mined']
    }});
    showToast('Card saved!');
    ankiSync();
    document.getElementById('mineSentence').value = '';
    document.getElementById('mineWord').value = '';
    document.getElementById('mineResult').classList.remove('visible');
  } catch(e) {
    showToast('Error saving: ' + e.message, true);
  }
}
