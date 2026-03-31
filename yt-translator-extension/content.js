// ============================================================
//  YT Live Translator — content.js
//  Captions → Google Translate → Web Speech API
// ============================================================

let config = {
  enabled: false,
  targetLang: 'en',
  voiceRate: 1.0,
  voiceVolume: 1.0,
  muteOriginal: false,
  selectedVoiceName: '',
};

let captionObserver = null;
let bodyObserver = null;
let lastCueText = '';
let lastCueTime = 0;
let lastSpokenText = '';       // what we actually said out loud
let speechQueue = [];
let isSpeaking = false;
let availableVoices = [];

// ── Bootstrap ────────────────────────────────────────────────
chrome.storage.sync.get(null, (data) => {
  Object.assign(config, data);
  loadVoices();
  if (config.enabled) init();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'UPDATE_CONFIG') return;
  const wasEnabled = config.enabled;
  Object.assign(config, msg.config);
  applyMuteOriginal();
  if (config.enabled && !wasEnabled) init();
  if (!config.enabled && wasEnabled) teardown();
});

// ── Voice selection ──────────────────────────────────────────
const QUALITY_KEYWORDS = ['enhanced', 'neural', 'natural', 'wavenet', 'premium'];

function loadVoices() {
  availableVoices = window.speechSynthesis.getVoices();
  if (!availableVoices.length) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      availableVoices = window.speechSynthesis.getVoices();
    }, { once: true });
  }
}

function getVoice() {
  if (!availableVoices.length) return null;
  if (config.selectedVoiceName) {
    const match = availableVoices.find(v => v.name === config.selectedVoiceName);
    if (match) return match;
  }
  const langVoices = availableVoices.filter(v =>
    v.lang.toLowerCase().startsWith(config.targetLang.toLowerCase())
  );
  const pool = langVoices.length ? langVoices : availableVoices;
  for (const keyword of QUALITY_KEYWORDS) {
    const hit = pool.find(v => v.name.toLowerCase().includes(keyword));
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

// ── Init / teardown ──────────────────────────────────────────
function init() {
  applyMuteOriginal();
  attachVideoListeners();
  waitForCaptionContainer((container) => {
    captionObserver = startCaptionObserver(container);
  });
  listenForNavigation();
  startKeepAlive();
}

function teardown() {
  captionObserver?.disconnect();
  bodyObserver?.disconnect();
  captionObserver = null;
  window.speechSynthesis.cancel();
  speechQueue = [];
  isSpeaking = false;
  lastSpokenText = '';
  unmuteOriginal();
  stopKeepAlive();
}

// ── Video listeners ──────────────────────────────────────────
function getVideo() {
  return document.querySelector('video');
}

function attachVideoListeners() {
  const video = getVideo();
  if (!video) return;
  video.addEventListener('pause', () => {
    window.speechSynthesis.cancel();
    speechQueue = [];
    isSpeaking = false;
  });
  video.addEventListener('play', () => {
    if (speechQueue.length) speakNext();
  });
  video.addEventListener('seeked', () => {
    window.speechSynthesis.cancel();
    speechQueue = [];
    isSpeaking = false;
    lastCueText = '';
    lastSpokenText = '';
  });
}

function applyMuteOriginal() {
  const video = getVideo();
  if (!video) return;
  video.muted = config.enabled && config.muteOriginal;
}

function unmuteOriginal() {
  const video = getVideo();
  if (video) video.muted = false;
}

// ── Overlap / repeat detection ────────────────────────────────
// Returns true if `next` is too similar to `prev` to bother speaking.
// Handles the common YouTube pattern of growing cues:
//   "hello how are" → "hello how are you" → "hello how are you doing"
function isTooSimilar(prev, next) {
  if (!prev || !next) return false;
  const a = normalise(prev);
  const b = normalise(next);
  if (a === b) return true;
  // If next starts with what we already said, it's just a grow — skip it
  if (b.startsWith(a)) return true;
  // If the overlap between the two is >70% of the shorter string, skip
  const overlapRatio = longestCommonPrefixLen(a, b) / Math.min(a.length, b.length);
  return overlapRatio > 0.7;
}

function normalise(str) {
  return str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function longestCommonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Extract only the NEW part of a growing cue.
// e.g. prev="hello how are", next="hello how are you doing" → "you doing"
function extractNewPart(prev, next) {
  if (!prev) return next;
  const a = normalise(prev);
  const b = normalise(next);
  if (b.startsWith(a)) {
    // Trim the already-spoken prefix from the raw next string
    const prefixLen = prev.trim().length;
    const remainder = next.slice(prefixLen).trim();
    return remainder.length > 2 ? remainder : null;
  }
  return next;
}

// ── Caption observation ──────────────────────────────────────
const CAPTION_SELECTORS = [
  '.ytp-caption-segment',
  '.captions-text span',
  '.ytp-subtitles-player-content span',
];

const CONTAINER_SELECTORS = [
  '.ytp-subtitles-player-content',
  '.captions-text',
  '.ytp-caption-window-container',
];

function findCaptionContainer() {
  for (const sel of CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function readCaptionText() {
  for (const sel of CAPTION_SELECTORS) {
    const segments = document.querySelectorAll(sel);
    if (segments.length) {
      return Array.from(segments)
        .map(s => s.textContent.trim())
        .filter(Boolean)
        .join(' ');
    }
  }
  return '';
}

function startCaptionObserver(container) {
  const observer = new MutationObserver(() => {
    if (!config.enabled) return;
    const text = readCaptionText();
    if (!text) return;

    const now = Date.now();
    // Debounce rapid-fire mutations
    if (now - lastCueTime < 300) return;
    // Exact duplicate
    if (text === lastCueText) return;

    const prev = lastCueText;
    lastCueText = text;
    lastCueTime = now;

    // Figure out what's actually new vs what we already spoke
    const toSpeak = extractNewPart(prev, text) ?? text;

    // If what's left is basically what we just said, skip it
    if (isTooSimilar(lastSpokenText, toSpeak)) return;

    handleNewCue(toSpeak, now);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return observer;
}

function waitForCaptionContainer(callback) {
  const existing = findCaptionContainer();
  if (existing) { callback(existing); return; }
  bodyObserver = new MutationObserver(() => {
    const container = findCaptionContainer();
    if (container) {
      bodyObserver.disconnect();
      bodyObserver = null;
      callback(container);
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

// ── SPA navigation ───────────────────────────────────────────
function listenForNavigation() {
  document.addEventListener('yt-navigate-finish', () => {
    captionObserver?.disconnect();
    captionObserver = null;
    window.speechSynthesis.cancel();
    speechQueue = [];
    isSpeaking = false;
    lastCueText = '';
    lastSpokenText = '';
    attachVideoListeners();
    applyMuteOriginal();
    waitForCaptionContainer((container) => {
      captionObserver = startCaptionObserver(container);
    });
  });
}

// ── Translation ──────────────────────────────────────────────
async function handleNewCue(text, timestamp) {
  try {
    const translated = await translate(text, config.targetLang);
    if (!translated) return;
    // Drop if cue is already stale (translation took too long)
    if (Date.now() - timestamp > 1500) return;
    enqueue(translated);
  } catch (err) {
    console.error('[YT Translator] Translation error:', err);
  }
}

async function translate(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translate failed: ${res.status}`);
  const data = await res.json();
  return data[0].map(item => item[0]).filter(Boolean).join('');
}

// ── Speech queue ─────────────────────────────────────────────
function enqueue(text) {
  speechQueue = [text]; // always replace — never queue up old cues
  if (!isSpeaking) speakNext();
}

function speakNext() {
  const video = getVideo();
  if (!speechQueue.length || video?.paused) {
    isSpeaking = false;
    return;
  }
  isSpeaking = true;
  const text = speechQueue.shift();
  lastSpokenText = text; // track what we actually spoke
  const utt = new SpeechSynthesisUtterance(text);
  utt.voice  = getVoice();
  utt.rate   = (video?.playbackRate ?? 1) * config.voiceRate;
  utt.volume = config.voiceVolume;
  utt.lang   = config.targetLang;
  utt.onend  = () => speakNext();
  utt.onerror = () => { isSpeaking = false; speakNext(); };
  window.speechSynthesis.speak(utt);
}

// ── Chrome 15s keepalive ──────────────────────────────────────
let keepAliveTimer = null;

function startKeepAlive() {
  keepAliveTimer = setInterval(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);
}

function stopKeepAlive() {
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

// ── Tab visibility ────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden && config.enabled) {
    window.speechSynthesis.cancel();
    speechQueue = [];
    isSpeaking = false;
  }
});
