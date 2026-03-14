// ── Sentence Mining tab ───────────────────────────────────────

function populateMineDeckSelect() {
  const sel = document.getElementById('mineDeckSelect');
  const current = sel.value;
  sel.innerHTML = '';
  document.querySelectorAll('.deck-item').forEach(btn => {
    const opt = document.createElement('option');
    opt.value = btn.dataset.deck;
    opt.textContent = btn.dataset.deck;
    // Default to Norsk::Sentences, then current, then anything
    if (btn.dataset.deck === 'Norsk::Sentences') opt.selected = true;
    else if (!current && btn.dataset.deck === currentDeck) opt.selected = true;
    else if (current && btn.dataset.deck === current) opt.selected = true;
    sel.appendChild(opt);
  });
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

    const response = await fetch('/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

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
