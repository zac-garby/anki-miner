// ── Browse tab ────────────────────────────────────────────────

async function loadDecks() {
  const el = document.getElementById('deckList');
  el.innerHTML = '<span class="muted">loading…</span>';
  try {
    const names = await anki('deckNames');
    names.sort();
    el.innerHTML = '';
    // Render buttons immediately, then fill counts async
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'deck-item';
      btn.dataset.deck = name;
      const safeId = 'count_' + name.replace(/[^a-zA-Z0-9]/g, '_');
      btn.innerHTML = name + `<span class="deck-count" id="${safeId}"></span>`;
      btn.onclick = () => selectDeck(name);
      el.appendChild(btn);
    });
    // Fetch note counts in parallel (exclude sub-decks for parent counts)
    names.forEach(async name => {
      try {
        const ids = await anki('findNotes', {query: `deck:"${name}"`});
        const safeId = 'count_' + name.replace(/[^a-zA-Z0-9]/g, '_');
        const span = document.getElementById(safeId);
        if (span) span.textContent = `(${ids.length})`;
      } catch(_) {}
    });
  } catch(e) {
    el.innerHTML = `<span class="muted">Error: ${e.message}</span>`;
  }
}

async function selectDeck(name) {
  currentDeck = name;
  selectedIds.clear();
  currentPage = 1;
  document.querySelectorAll('.deck-item').forEach(b => b.classList.toggle('active', b.dataset.deck === name));
  document.getElementById('deckTitle').textContent = name;
  document.getElementById('cardsSection').style.display = 'block';
  document.getElementById('notesBody').innerHTML = '<tr><td colspan="6" class="muted">loading…</td></tr>';
  document.getElementById('pagination').innerHTML = '';
  document.getElementById('searchInput').value = '';
  updateBulkBar();

  try {
    const noteIds = await anki('findNotes', {query: `deck:"${name}"`});
    if (!noteIds.length) { allNotes = []; renderTable(); renderPagination(); return; }

    // Batch load notes (500 at a time)
    const noteBatches = [];
    for (let i = 0; i < noteIds.length; i += 500) noteBatches.push(noteIds.slice(i, i+500));
    const noteResults = await Promise.all(noteBatches.map(b => anki('notesInfo', {notes: b})));
    allNotes = noteResults.flat();

    applyFiltersAndSort();
  } catch(e) {
    document.getElementById('notesBody').innerHTML = `<tr><td colspan="5" class="muted">Error: ${e.message}</td></tr>`;
  }
}

async function attachDueDates() {
  try {
    const cardIds = await anki('findCards', {query: `deck:"${currentDeck}"`});
    const batches = [];
    for (let i = 0; i < cardIds.length; i += 500) batches.push(cardIds.slice(i, i+500));
    const results = await Promise.all(batches.map(b => anki('cardsInfo', {cards: b})));
    const cards = results.flat();

    // Derive collection epoch if not yet known.
    // Anki due days are relative to collection creation date (local midnight).
    // For review cards: due = days since epoch. We infer epoch from:
    // card created at cardId ms; it was first seen on day (due - interval).
    // So epoch ≈ (cardId/1000 - (due - interval) * 86400), rounded to day boundary.
    if (!collectionEpoch) {
      const reviewCards = cards.filter(c => c.type === 2 && c.due > 0 && c.due < 99999 && c.interval > 0);
      if (reviewCards.length > 0) {
        const offsets = reviewCards.map(c => {
          const createdSec = c.cardId / 1000;
          const firstSeenDay = c.due - c.interval;
          return createdSec - firstSeenDay * 86400;
        });
        offsets.sort((a, b) => a - b);
        const median = offsets[Math.floor(offsets.length / 2)];
        collectionEpoch = Math.round(median / 86400) * 86400 * 1000;
      } else {
        collectionEpoch = Date.UTC(2006, 0, 1); // fallback
      }
    }

    const noteMap = {};
    cards.forEach(c => {
      if (noteMap[c.note] === undefined || c.due < noteMap[c.note].due) {
        noteMap[c.note] = {due: c.due, type: c.type, queue: c.queue};
      }
    });
    allNotes.forEach(n => {
      n._due = noteMap[n.noteId]?.due ?? 0;
      n._type = noteMap[n.noteId]?.type ?? 0;
      n._queue = noteMap[n.noteId]?.queue ?? 0;
    });
  } catch(e) {
    allNotes.forEach(n => { n._due = 0; n._type = 0; n._queue = 0; });
  }
}

function onSearch() { currentPage = 1; applyFiltersAndSort(); }
function onSortChange() { currentPage = 1; applyFiltersAndSort(); }

function applyFiltersAndSort() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim();
  let notes = allNotes;
  if (q) {
    notes = notes.filter(n =>
      Object.values(n.fields).some(f => stripHtml(f.value).toLowerCase().includes(q)) ||
      (n.tags||[]).some(t => t.toLowerCase().includes(q))
    );
  }
  const sort = document.getElementById('sortSelect').value;
  notes = [...notes];
  if (sort === 'created-asc')  notes.sort((a,b) => a.noteId - b.noteId);
  if (sort === 'created-desc') notes.sort((a,b) => b.noteId - a.noteId);
  if (sort === 'due-asc')      notes.sort((a,b) => (a._due||0) - (b._due||0));
  if (sort === 'due-desc')     notes.sort((a,b) => (b._due||0) - (a._due||0));
  if (sort === 'alpha-asc')    notes.sort((a,b) => sortField(a).localeCompare(sortField(b)));
  if (sort === 'alpha-desc')   notes.sort((a,b) => sortField(b).localeCompare(sortField(a)));
  filteredNotes = notes;
  renderTable();
  renderPagination();
}

function sortField(n) {
  const vals = Object.values(n.fields);
  return vals.length ? stripHtml(vals[0].value).toLowerCase() : '';
}

function renderTable() {
  const tbody = document.getElementById('notesBody');
  if (!filteredNotes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No notes found.</td></tr>';
    document.getElementById('selectAll').checked = false;
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredNotes.slice(start, start + PAGE_SIZE);
  tbody.innerHTML = '';
  page.forEach(note => {
    const fields = Object.values(note.fields);
    const front = stripHtml(fields[0]?.value || '');
    const back  = stripHtml(fields[1]?.value || '');
    const chk   = selectedIds.has(note.noteId) ? 'checked' : '';
    const hasAudio = Object.values(note.fields).some(f => /\[sound:/.test(f.value || ''));
    const audioCell = hasAudio ? '' : '<span class="no-audio">no audio</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" ${chk} onchange="toggleSelect(${note.noteId}, this)"></td>
      <td class="front" title="${esc(front)}">${esc(front)}</td>
      <td class="back"  title="${esc(back)}">${esc(back)}</td>
      <td class="col-audio">${audioCell}</td>
      <td class="actions"><button class="small" onclick="openEditModal(${note.noteId})">edit</button></td>`;
    tbody.appendChild(tr);
  });
  const allOnPage = page.every(n => selectedIds.has(n.noteId));
  document.getElementById('selectAll').checked = allOnPage && page.length > 0;
}

function formatDue(due, type, queue) {
  // queue: -3=sched buried, -2=user buried, -1=suspended, 0=new, 1=learning, 2=review, 3=day-learn, 4=preview
  if (queue === -1) return {text: 'suspended', overdue: false};
  if (queue === -2 || queue === -3) return {text: 'buried', overdue: false};
  if (type === 0 || type === 1) return {text: 'new', overdue: false};
  if (!due || due <= 0) return {text: '—', overdue: false};
  try {
    const epoch = collectionEpoch ?? Date.UTC(2006, 0, 1);
    const d = new Date(epoch + due * 86400 * 1000);
    if (isNaN(d.getTime())) return {text: '—', overdue: false};
    const overdue = d < new Date();
    const text = d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'2-digit'});
    return {text, overdue};
  } catch { return {text: '—', overdue: false}; }
}

function renderPagination() {
  const total = filteredNotes.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('pagination');
  if (pages <= 1) { el.innerHTML = `<span class="page-info">${total} note${total!==1?'s':''}</span>`; return; }
  let html = `<button class="page-btn" onclick="goPage(${currentPage-1})" ${currentPage===1?'disabled':''}>←</button>`;
  const range = pageRange(currentPage, pages);
  let prev = null;
  range.forEach(p => {
    if (prev !== null && p - prev > 1) html += '<span class="muted" style="padding:0 2px">…</span>';
    html += `<button class="page-btn${p===currentPage?' current':''}" onclick="goPage(${p})">${p}</button>`;
    prev = p;
  });
  html += `<button class="page-btn" onclick="goPage(${currentPage+1})" ${currentPage===pages?'disabled':''}>→</button>`;
  html += `<span class="page-info">${total} notes · page ${currentPage}/${pages}</span>`;
  el.innerHTML = html;
}

function pageRange(cur, total) {
  const s = new Set([1, total]);
  for (let i = Math.max(2, cur-2); i <= Math.min(total-1, cur+2); i++) s.add(i);
  return [...s].sort((a,b)=>a-b);
}

function goPage(p) {
  const pages = Math.ceil(filteredNotes.length / PAGE_SIZE);
  if (p < 1 || p > pages) return;
  currentPage = p;
  renderTable();
  renderPagination();
  document.getElementById('cardsSection').scrollIntoView({behavior:'smooth',block:'start'});
}

function toggleSelect(noteId, cb) {
  if (cb.checked) selectedIds.add(noteId); else selectedIds.delete(noteId);
  updateBulkBar(); syncSelectAll();
}

function toggleSelectAll(cb) {
  const start = (currentPage - 1) * PAGE_SIZE;
  filteredNotes.slice(start, start + PAGE_SIZE).forEach(n => cb.checked ? selectedIds.add(n.noteId) : selectedIds.delete(n.noteId));
  renderTable(); updateBulkBar();
}

function clearSelection() { selectedIds.clear(); renderTable(); updateBulkBar(); }

function syncSelectAll() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filteredNotes.slice(start, start + PAGE_SIZE);
  document.getElementById('selectAll').checked = page.length > 0 && page.every(n => selectedIds.has(n.noteId));
}

function updateBulkBar() {
  const n = selectedIds.size;
  document.getElementById('bulkBar').classList.toggle('visible', n > 0);
  document.getElementById('bulkCount').textContent = `${n} selected`;
}

async function burySelected() {
  if (!selectedIds.size) return;
  try {
    const cardIds = (await Promise.all([...selectedIds].map(nid => anki('findCards', {query:`nid:${nid}`})))).flat();
    await anki('buryCards', {cards: cardIds});
    showToast(`Buried ${selectedIds.size} note(s)`);
    clearSelection();
    selectDeck(currentDeck);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

async function suspendSelected() {
  if (!selectedIds.size) return;
  try {
    const cardIds = (await Promise.all([...selectedIds].map(nid => anki('findCards', {query:`nid:${nid}`})))).flat();
    await anki('suspend', {cards: cardIds});
    showToast(`Suspended ${selectedIds.size} note(s)`);
    clearSelection();
    selectDeck(currentDeck);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

async function deleteSelected() {
  if (!selectedIds.size) return;
  if (!confirm(`Delete ${selectedIds.size} note(s)? This cannot be undone.`)) return;
  try {
    await anki('deleteNotes', {notes: [...selectedIds]});
    showToast(`Deleted ${selectedIds.size} note(s)`);
    clearSelection();
    selectDeck(currentDeck);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

// ── Modal (edit / add note) ───────────────────────────────────

function openEditModal(noteId) {
  isAdding = false;
  editingNoteId = noteId;
  const note = allNotes.find(n => n.noteId === noteId);
  if (!note) return;
  document.getElementById('modalTitle').textContent = 'Edit note';
  const c = document.getElementById('modalFields');
  c.innerHTML = '';
  Object.entries(note.fields).forEach(([name, data]) => {
    c.innerHTML += `<div class="field-group"><label class="field-label">${name}</label><textarea id="field_${name}">${esc(data.value)}</textarea></div>`;
  });
  c.innerHTML += `<div class="field-group"><label class="field-label">Tags (space-separated)</label><input type="text" id="field_tags" value="${esc((note.tags||[]).join(' '))}" style="width:100%"></div>`;
  document.getElementById('modal').classList.add('open');
}

function openAddModal() {
  if (!currentDeck) return;
  isAdding = true; editingNoteId = null;
  document.getElementById('modalTitle').textContent = 'Add note';
  document.getElementById('modalFields').innerHTML = `
    <div class="field-group"><label class="field-label">Front</label><textarea id="field_Front" placeholder="Question / front"></textarea></div>
    <div class="field-group"><label class="field-label">Back</label><textarea id="field_Back" placeholder="Answer / back"></textarea></div>
    <div class="field-group"><label class="field-label">Tags (space-separated)</label><input type="text" id="field_tags" style="width:100%"></div>`;
  document.getElementById('modal').classList.add('open');
}

async function saveNote() { isAdding ? await addNote() : await updateNote(); }

async function updateNote() {
  const note = allNotes.find(n => n.noteId === editingNoteId);
  if (!note) return;
  const fields = {};
  Object.keys(note.fields).forEach(name => { const el = document.getElementById(`field_${name}`); if (el) fields[name] = el.value; });
  const tagsEl = document.getElementById('field_tags');
  try {
    await anki('updateNoteFields', {note: {id: editingNoteId, fields}});
    if (tagsEl) await anki('updateNoteTags', {note: editingNoteId, tags: tagsEl.value.trim().split(/\s+/).filter(Boolean).join(' ')});
    showToast('Note updated');
    closeModal();
    selectDeck(currentDeck);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

async function addNote() {
  const front = document.getElementById('field_Front')?.value?.trim();
  const back  = document.getElementById('field_Back')?.value?.trim();
  const tags  = document.getElementById('field_tags')?.value?.trim().split(/\s+/).filter(Boolean) || [];
  if (!front || !back) { showToast('Front and back are required', true); return; }
  try {
    await anki('addNote', {note: {deckName: currentDeck, modelName: 'Basic', fields: {Front: front, Back: back}, tags}});
    showToast('Note added');
    closeModal();
    selectDeck(currentDeck);
  } catch(e) { showToast('Error: ' + e.message, true); }
}

function closeModal() { document.getElementById('modal').classList.remove('open'); editingNoteId = null; }
function onModalBgClick(e) { if (e.target === document.getElementById('modal')) closeModal(); }
