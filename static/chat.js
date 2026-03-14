// ── Chat tab ──────────────────────────────────────────────────

const CHAT_PRESETS = {
  tutor: 'You are a helpful Norwegian language tutor. Chat naturally in Norwegian at a B1–B2 level. Keep responses conversational and relatively brief (2–4 sentences unless asked for more).',
  cafe: 'Du er en servitør på en hyggelig kafe i Oslo. Kunden (brukeren) ønsker å bestille mat og drikke. Hold deg i rollen, svar naturlig på norsk, og vær vennlig og litt uformell.',
  interview: 'Du er en intervjuer i et norsk teknologiselskap. Gjennomfør et jobbintervju på norsk med kandidaten (brukeren). Still relevante spørsmål og gi naturlige oppfølgingssvar.',
  friend: 'Du er en norsk venn som snakker uformelt og hverdagslig. Bruk dagligdags norsk, gjerne med litt slang. Svar kort og naturlig, som i en ekte tekstsamtale.'
};

function chatLoad() {
  try { chatConversations = JSON.parse(localStorage.getItem('anki-chat') || '[]'); } catch { chatConversations = []; }
}

function chatSave() {
  const toSave = chatConversations.map(c => ({
    ...c, messages: c.messages.filter(m => !m._thinking)
  }));
  localStorage.setItem('anki-chat', JSON.stringify(toSave));
}

function chatCurrentConv() {
  return chatConversations.find(c => c.id === chatCurrentId) || null;
}

function chatInitTab() {
  chatLoad();
  chatPopulateDeckSelect();
  if (!chatCurrentId && chatConversations.length) {
    chatSelectConversation(chatConversations[0].id);
  } else if (!chatConversations.length) {
    chatNewConversation();
  } else {
    chatRenderConvList();
    chatRenderMessages();
  }
}

async function chatPopulateDeckSelect() {
  const sel = document.getElementById('chatDeckSelect');
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
  } catch { /* Anki not connected; leave empty */ }
}

function chatNewConversation() {
  const id = Date.now().toString();
  const conv = {
    id, title: 'New conversation',
    systemPrompt: CHAT_PRESETS.tutor,
    messages: [], createdAt: Date.now(), updatedAt: Date.now()
  };
  chatConversations.unshift(conv);
  chatSave();
  chatSelectConversation(id);
}

function chatSelectConversation(id) {
  chatCurrentId = id;
  const conv = chatCurrentConv();
  if (!conv) return;
  document.getElementById('chatSystem').value = conv.systemPrompt;
  chatRenderConvList();
  chatRenderMessages();
}

function chatRenderConvList() {
  const el = document.getElementById('convList');
  if (!chatConversations.length) {
    el.innerHTML = '<span class="muted" style="font-size:0.82em;padding:4px">No conversations yet.</span>';
    return;
  }
  el.innerHTML = '';
  chatConversations.forEach(conv => {
    const div = document.createElement('div');
    div.className = 'conv-item' + (conv.id === chatCurrentId ? ' active' : '');
    div.textContent = conv.title;
    div.title = conv.title;
    div.onclick = () => chatSelectConversation(conv.id);
    el.appendChild(div);
  });
}

function chatRenderMessages() {
  const el = document.getElementById('chatMessages');
  const conv = chatCurrentConv();
  if (!conv || !conv.messages.length) {
    el.innerHTML = '<div class="chat-empty">Start the conversation…</div>';
    return;
  }
  el.innerHTML = '';
  conv.messages.forEach(msg => el.appendChild(chatBuildMessage(msg)));
  el.scrollTop = el.scrollHeight;
}

function chatBuildMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = 'chat-msg ' + msg.role;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble' + (msg._thinking ? ' thinking' : '');
  if (msg._thinking) {
    bubble.textContent = 'thinking…';
  } else if (msg.role === 'assistant') {
    chatRenderAssistantText(msg.content, bubble);
  } else {
    bubble.textContent = msg.content;
  }
  wrap.appendChild(bubble);

  if (msg.role === 'user' && msg.analysis) {
    wrap.appendChild(chatBuildAnalysis(msg.analysis));
  }
  return wrap;
}

function chatRenderAssistantText(text, container) {
  const paras = text.split(/\n{2,}/);
  paras.forEach((para, pi) => {
    if (pi > 0) container.appendChild(document.createElement('br'));
    if (!para.trim()) return;
    const segs = para.match(/[^.!?]+[.!?]*\s*/g) || [para];
    segs.forEach(seg => {
      const s = seg.trim();
      if (!s) return;
      const span = document.createElement('span');
      span.className = 'chat-sentence';
      span.title = 'Open in Sentence Mining';
      span.textContent = s + ' ';
      span.onclick = () => chatMine(s);
      container.appendChild(span);
    });
  });
}

function chatBuildAnalysis(analysis) {
  const hasIssues = analysis.issues && analysis.issues.length > 0;

  const outer = document.createElement('div');
  outer.className = 'chat-analysis';

  // Toggle header
  const header = document.createElement('div');
  header.className = 'chat-analysis-header';
  const verdict = document.createElement('span');
  verdict.className = 'analysis-verdict ' + (hasIssues ? (analysis.verdict === 'major' ? 'bad' : 'warn') : 'good');
  verdict.textContent = hasIssues
    ? (analysis.verdict === 'major' ? '✗ Some errors' : '~ Minor issues')
    : '✓ Looks correct';
  const toggle = document.createElement('span');
  toggle.className = 'analysis-toggle';
  toggle.textContent = '▾';
  header.appendChild(verdict);
  header.appendChild(toggle);
  outer.appendChild(header);

  // Collapsible body (hidden by default when correct, shown when issues)
  const body = document.createElement('div');
  body.className = 'chat-analysis-body';
  body.style.display = hasIssues ? 'block' : 'none';
  toggle.textContent = hasIssues ? '▾' : '▸';

  header.onclick = () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    toggle.textContent = open ? '▸' : '▾';
  };

  if (!hasIssues) {
    outer.appendChild(body);
    return outer;
  }

  const issues = document.createElement('div');
  issues.className = 'analysis-issues';
  analysis.issues.forEach(issue => {
    const p = document.createElement('div');
    p.className = 'analysis-issue';
    p.innerHTML =
      `<span class="issue-original">${esc(issue.original)}</span>` +
      `<span class="issue-correction">→ ${esc(issue.correction)}</span>` +
      `<span class="issue-explanation">${esc(issue.explanation)}</span>`;
    issues.appendChild(p);
  });
  body.appendChild(issues);

  const unsavedCards = (analysis.cards || []).filter(c => !c.saved);
  if (unsavedCards.length) {
    const cardsDiv = document.createElement('div');
    cardsDiv.innerHTML = '<div class="analysis-cards-label">Suggested cards:</div>';
    unsavedCards.forEach(card => {
      const row = document.createElement('div');
      row.className = 'analysis-card';
      const preview = document.createElement('code');
      preview.className = 'cloze-preview';
      preview.textContent = card.text;
      const btn = document.createElement('button');
      btn.className = 'small';
      btn.textContent = 'Save to Anki';
      btn.onclick = async () => {
        await chatSaveClozeCard(card.text);
        card.saved = true;
        chatSave();
        row.remove();
        if (!cardsDiv.querySelector('.analysis-card')) cardsDiv.remove();
      };
      row.appendChild(preview);
      row.appendChild(btn);
      cardsDiv.appendChild(row);
    });
    body.appendChild(cardsDiv);
  }

  outer.appendChild(body);
  return outer;
}

async function chatSend() {
  const conv = chatCurrentConv();
  if (!conv) return;
  const inputEl = document.getElementById('chatInput');
  const userText = inputEl.value.trim();
  if (!userText) return;

  inputEl.value = '';
  document.getElementById('chatSendBtn').disabled = true;

  const userMsg = { role: 'user', content: userText, timestamp: Date.now() };
  conv.messages.push(userMsg);
  conv.updatedAt = Date.now();
  if (conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = userText.slice(0, 48) + (userText.length > 48 ? '…' : '');
  }

  const thinkingMsg = { role: 'assistant', content: '', timestamp: Date.now(), _thinking: true };
  conv.messages.push(thinkingMsg);
  chatSave();
  chatRenderConvList();
  chatRenderMessages();

  // Last 6 messages before the one just added (excludes thinking placeholder)
  const recentContext = conv.messages
    .filter(m => !m._thinking)
    .slice(-7, -1)
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const apiMessages = conv.messages
      .filter(m => !m._thinking)
      .map(m => ({ role: m.role, content: m.content }));

    const [replyText, analysis] = await Promise.all([
      chatCallAPI(apiMessages, conv.systemPrompt),
      chatAnalyzeMessage(userText, recentContext)
    ]);

    conv.messages.pop(); // remove thinking
    conv.messages.push({ role: 'assistant', content: replyText, timestamp: Date.now() });
    userMsg.analysis = analysis;
    conv.updatedAt = Date.now();
    chatSave();
    chatRenderConvList();
    chatRenderMessages();
  } catch(e) {
    conv.messages.pop();
    chatSave();
    chatRenderMessages();
    showToast('Chat error: ' + e.message, true);
  } finally {
    document.getElementById('chatSendBtn').disabled = false;
  }
}

async function chatCallAPI(messages, system) {
  const resp = await fetch('/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || '';
}

async function chatAnalyzeMessage(userMsg, recentContext) {
  let contextSection = '';
  if (recentContext && recentContext.length > 0) {
    const lines = recentContext
      .map(m => `${m.role === 'user' ? 'Learner' : 'Tutor'}: "${m.content}"`)
      .join('\n');
    contextSection = `\nConversation so far:\n${lines}\n`;
  }
  const prompt =
`You are analysing a Norwegian message written by a language learner.${contextSection}
Learner's latest message: "${userMsg}"

Using the conversation context above to understand what is being discussed, check the learner's message for grammar errors and unnatural phrasing. Do NOT flag things that are correct in context. Return ONLY valid JSON in this exact format — no other text:
{
  "issues": [
    {"original": "the exact problematic phrase", "correction": "how a native would say it", "explanation": "brief explanation"}
  ],
  "cards": [
    {"text": "corrected full sentence with {{c1::the english of what they intended to say::the correct Norwegian part of the sentence}}"}
  ],
  "verdict": "perfect"
}

Rules:
- If there are no issues, return "issues": [], "cards": [], "verdict": "perfect"
- Only flag genuine errors, not stylistic alternatives
- Only include a card for actual mistakes, not correct usage
- The "text" field must use valid Anki cloze syntax: {{c1::correct}}, {{c2::correct}}, etc.
- verdict is one of: "perfect", "minor", "major"`;

  const resp = await fetch('/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await resp.json();
  if (data.error) return { issues: [], cards: [], verdict: 'perfect' };
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { issues: [], cards: [], verdict: 'perfect' };
  }
}

function chatMine(sentence) {
  switchTab('mine');
  document.getElementById('mineSentence').value = sentence;
  document.getElementById('mineWord').focus();
}

async function chatSaveClozeCard(text) {
  const deck = document.getElementById('chatDeckSelect').value || 'Norsk::Sentences';
  try {
    await anki('addNote', {
      note: {
        deckName: deck,
        modelName: 'Cloze',
        fields: { Text: text },
        tags: ['mined', 'chat']
      }
    });
    showToast('Cloze card saved!');
    ankiSync();
  } catch(e) {
    showToast('Error saving card: ' + e.message, true);
  }
}

function chatSetPreset(name) {
  const prompt = CHAT_PRESETS[name] || '';
  document.getElementById('chatSystem').value = prompt;
  const conv = chatCurrentConv();
  if (conv) { conv.systemPrompt = prompt; chatSave(); }
}

function chatOnSystemChange() {
  const conv = chatCurrentConv();
  if (conv) { conv.systemPrompt = document.getElementById('chatSystem').value; chatSave(); }
}

function chatOnKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); }
}

