#!/usr/bin/env python3
"""
Flask server for the Anki sentence mining dashboard.
- Serves the dashboard at http://localhost:8001
- Proxies requests to the Anthropic API at /messages

Setup (one time):
    uv init anki-proxy
    cd anki-proxy
    uv add flask requests

Run:
    ANTHROPIC_API_KEY=sk-ant-... uv run proxy.py
"""

import os
import re
import sys
import subprocess
import tempfile
import requests
from flask import Flask, request, jsonify, send_from_directory

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

if not API_KEY:
    print("ERROR: ANTHROPIC_API_KEY environment variable not set.")
    print("Run as: ANTHROPIC_API_KEY=sk-ant-... uv run proxy.py")
    sys.exit(1)

# Serve files from the same directory as this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "anki-dashboard.html")

@app.route("/messages", methods=["OPTIONS"])
def preflight():
    response = jsonify({})
    response.status_code = 204
    return response

@app.route("/messages", methods=["POST"])
def messages():
    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        json=request.get_json(),
        headers={
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    return jsonify(resp.json()), resp.status_code

@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return response

_SENTENCE_END = re.compile(r'[.!?…]\s*$')

def parse_subtitle_text(content):
    """Extract clean sentences from VTT or SRT content, joining split fragments."""
    lines = content.splitlines()
    texts = []
    for line in lines:
        line = line.strip()
        # Skip blanks, WEBVTT header, NOTE blocks, SRT sequence numbers, timestamps
        if not line:
            continue
        if re.match(r'^(WEBVTT|NOTE|STYLE)', line):
            continue
        if re.match(r'^\d+$', line):
            continue
        if '-->' in line:
            continue
        # Strip VTT/HTML tags and positioning directives
        line = re.sub(r'<[^>]+>', '', line)
        line = re.sub(r'\{[^}]+\}', '', line)
        line = line.strip()
        if len(line) > 3:
            texts.append(line)

    # Deduplicate preserving order (subtitles repeat lines while they stay on screen)
    seen = set()
    unique = []
    for t in texts:
        if t not in seen:
            seen.add(t)
            unique.append(t)

    # Join fragments: accumulate lines until we hit sentence-ending punctuation
    sentences = []
    current = ''
    for text in unique:
        current = (current + ' ' + text).strip() if current else text
        if _SENTENCE_END.search(current):
            sentences.append(current)
            current = ''
    if current:
        sentences.append(current)

    return sentences


def _run_ytdlp(url, tmpdir, extra_args):
    out_tmpl = os.path.join(tmpdir, 'output.%(ext)s')
    return subprocess.run(
        ['yt-dlp', '--write-sub', '--write-auto-sub',
         '--skip-download', '--no-playlist', '--no-update',
         '-o', out_tmpl, url] + extra_args,
        capture_output=True, text=True, timeout=90,
    )

def _sub_files(tmpdir):
    return [f for f in os.listdir(tmpdir) if f.endswith(('.vtt', '.srt'))]

def _pick_best_sub(files):
    """Prefer Norwegian-language subtitle files over others."""
    no_langs = {'nb', 'no', 'nn', 'nb-ttv', 'nor', 'nob'}
    def priority(fn):
        stem = fn.lower()
        for lang in no_langs:
            if f'.{lang}.' in stem:
                return 0
        return 1
    return sorted(files, key=priority)[0]

@app.route('/fetch-subtitles', methods=['POST'])
def fetch_subtitles():
    data = request.get_json()
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'No URL provided'}), 400
    with tempfile.TemporaryDirectory() as tmpdir:
        # Try 1: known Norwegian language codes (NRK uses nb-ttv, YouTube uses nb/no)
        r1 = _run_ytdlp(url, tmpdir, ['--sub-lang', 'nb,no,nn,nb-ttv,nb-NO,no-NO,nor'])
        files = _sub_files(tmpdir)
        # Try 2: fall back to all available subs and pick the best
        if not files:
            r2 = _run_ytdlp(url, tmpdir, ['--all-subs'])
            files = _sub_files(tmpdir)
        if not files:
            stderr = (r1.stderr + (r2.stderr if 'r2' in dir() else ''))[-1000:]
            return jsonify({'error': 'No subtitles found for this URL', 'detail': stderr}), 404
        chosen = _pick_best_sub(files)
        with open(os.path.join(tmpdir, chosen), encoding='utf-8') as f:
            content = f.read()
    sentences = parse_subtitle_text(content)
    return jsonify({'sentences': sentences, 'subtitle_file': chosen})


@app.route('/upload-subtitles', methods=['POST'])
def upload_subtitles():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    f = request.files['file']
    content = f.read().decode('utf-8', errors='replace')
    fname = f.filename or ''
    if fname.endswith('.txt'):
        # Plain text: split on sentence-ending punctuation
        raw = re.split(r'(?<=[.!?])\s+', content)
        sentences = [s.strip() for s in raw if len(s.strip()) > 3]
    else:
        sentences = parse_subtitle_text(content)
    return jsonify({'sentences': sentences})


if __name__ == "__main__":
    print(f"Dashboard: http://localhost:8001")
    app.run(port=8001, debug=True)
