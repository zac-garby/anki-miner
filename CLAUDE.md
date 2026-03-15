# anki-miner

A Norwegian language learning tool combining an Anki deck browser with AI-powered sentence mining and chat practice.

## Running

```
ANTHROPIC_API_KEY=sk-ant-... uv run main.py
```

Serves at http://localhost:8001. Requires Anki to be running with AnkiConnect, OR the remote headless AnkiConnect server at `https://box.zacgarby.co.uk:8765` (default).

## Architecture

No build step. Plain JS, no framework.

### Backend — `main.py`

Flask server (port 8001):
- `GET /` — serves `anki-dashboard.html`
- `POST /messages` — proxies to Anthropic API (injects `ANTHROPIC_API_KEY`)
- `GET /lookup-word?w=<word>` — proxies to `ord.uib.no` (ordbokene.no REST API) for Norwegian dictionary lookups; returns lemma, POS, inflection tags
- `POST /fetch-subtitles` — runs `yt-dlp` to fetch subtitles from a URL, parses and joins sentence fragments
- `POST /upload-subtitles` — parses uploaded `.vtt`/`.srt`/`.txt` subtitle files

Subtitle parsing (`parse_subtitle_text`): strips timing/tags, deduplicates repeated lines, joins fragments into complete sentences by accumulating until sentence-ending punctuation.

### Frontend

- `anki-dashboard.html` — HTML shell; loads scripts in order: `app.js`, `browse.js`, `mine.js`, `chat.js`, `media.js`
- `static/app.js` — globals, shared utilities, AnkiConnect client
- `static/browse.js` — Browse tab
- `static/mine.js` — Sentence Mining tab
- `static/chat.js` — Chat tab
- `static/media.js` — Media Mining tab
- `static/style.css` — all styles, includes `@media (max-width: 600px)` mobile breakpoint

## AnkiConnect

Default server: `https://box.zacgarby.co.uk:8765` (headless, remote).

`anki(action, params)` in `app.js` — all calls go through this. Includes `key` field if `ankiKey` cookie is set. On init, calls `requestPermission`; if denied, shows a modal to enter the API key (stored in cookie `ankiKey`).

`ankiSync()` — triggers AnkiWeb sync. Called on page load and after every card save.

## Tabs

### Browse

- Lists decks; clicking loads notes (batched 500 at a time via `notesInfo`)
- Table: checkbox, Front, Back, audio status ("no audio" if no `[sound:...]` in any field), edit button
- Search, sort (created/due/alpha), pagination (PAGE_SIZE=50)
- Bulk actions: bury, suspend, delete
- Inline edit modal; add Basic notes

### Sentence Mining (`mine.js`)

1. User pastes a Norwegian sentence + optionally types a difficult word
2. Calls Claude (haiku) — returns `{translation, breakdown: [{text, meaning}]}`
3. Each breakdown item is looked up on ordbokene.no via `/lookup-word`
4. A second Claude call verifies/corrects the breakdown using the dictionary data (`verifyAndCorrectBreakdown` in `app.js`)
5. User clicks a breakdown chip to select it → populates Word fields
6. Save as "Sentence mining" note (fields: Front / Word (no) / Word (en) / Audio)
7. Default deck: `Norsk::Sentences`

Prompt instructs Claude to use Norwegian synonyms for B1 learners, fall back to English, and correctly identify verb infinitives (å + verb).

### Chat (`chat.js`)

- Multiple conversations stored in `localStorage` key `anki-chat` (max 40 conversations, max 120 messages each)
- Conversation list in sidebar (horizontal strip on mobile)
- Presets: Tutor, Café, Intervju, Venn — each sets a system prompt
- Each user message triggers two parallel calls:
  1. Main assistant reply (claude-sonnet-4-6 via configurable system prompt)
  2. Grammar analysis (haiku) — checks Norwegian with full conversation context (last 6 messages), returns `{issues, cards, verdict}`
- Analysis shown below user bubble (collapsible); verdict = perfect/minor/major
- Cloze cards can be saved to Anki from analysis results
- Clicking a sentence in an assistant message opens it in the Sentence Mining tab
- Delete individual messages (× on hover) or entire conversations (× in sidebar)

### Media Mining (`media.js`)

1. Fetch subtitles from a URL (via yt-dlp) or upload a file
2. All sentences rendered immediately as a list (not analysed yet)
3. Click a sentence → calls Claude (haiku) for `{translation, breakdown}`
4. `verifyAndCorrectBreakdown` called on result
5. User clicks a breakdown chip → cloze card auto-generated as `{{c1::word::meaning}}`
6. Save as "Sentence mining" note or "Cloze" note

## Shared utilities (`app.js`)

- `anki(action, params)` — AnkiConnect client
- `ankiSync()` — trigger AnkiWeb sync
- `verifyAndCorrectBreakdown(sentence, breakdown)` — batch-looks up all words on ordbokene.no, then asks Claude to correct any errors (especially wrong verb infinitives)
- `showToast(msg, isError)`, `esc(s)`, `stripHtml(html)`
- Tab switching via `switchTab(tab)` and `location.hash`

## Models used

- `claude-haiku-4-5-20251001` — analysis, mining, verification (fast/cheap)
- `claude-sonnet-4-6` — chat replies (better conversational quality)

## Anki note models expected

- `Sentence mining` — fields: `Front`, `Word (no)`, `Word (en)`, `Audio`
- `Cloze` — field: `Text`
- `Basic` — fields: `Front`, `Back`
