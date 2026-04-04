// ============================================================
//  YT Live Translator — content.js v0.3.0
//  Improvements:
//  - Dual detection: MutationObserver + polling fallback
//  - Translation pre-fetching (fires immediately on new cue)
//  - Auto-enable CC button if captions are off
//  - Smarter repeat/overlap filtering
//  - Speaks most recent ready translation, drops stale ones
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
let pollTimer = null;

let lastCueText = '';
let lastCueTime = 0;
let lastSpokenText = '';

// Pre-fetch map: cueText → Promise<translatedText>
// We kick off translation immediately and just await the result when ready to speak
let pendingTranslation = null;  // { cueText, promise, timestamp }

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
  for (const kw of QUALITY_KEYWORDS) {
    const hit = pool.find(v => v.name.toLowerCase().includes(kw));
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

// ── Init / teardown ──────────────────────────────────────────
function init() {
  applyMuteOriginal();
  tryEnableCaptions();
  attachVideoListeners();
  waitForCaptionContainer((container) => {
    captionObserver = startCaptionObserver(container);
    startPolling(); // belt-and-suspenders alongside MutationObserver
  });
  listenForNavigation();
  startKeepAlive();
}

function teardown() {
  captionObserver?.disconnect();
  bodyObserver?.disconnect();
  captionObserver = null;
  stopPolling();
  window.speechSynthesis.cancel();
  pendingTranslation = null;
  isSpeaking = false;
  lastSpokenText = '';
  unmuteOriginal();
  stopKeepAlive();
}

// ── Auto-enable captions ─────────────────────────────────────
function tryEnableCaptions() {
  // Give the player a moment to render before looking for the CC button
  setTimeout(() => {
    const ccBtn = document.querySelector('.ytp-subtitles-button');
    if (!ccBtn) return;
    const isOn = ccBtn.getAttribute('aria-pressed') === 'true';
    if (!isOn) {
      ccBtn.click();
      console.log('[YT Translator] Auto-enabled captions');
    }
  }, 1500);
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
    pendingTranslation = null;
    isSpeaking = false;
  });

  video.addEventListener('play', () => {
    // Nothing special needed — next cue will trigger speech
  });

  video.addEventListener('seeked', () => {
    window.speechSynthesis.cancel();
    pendingTranslation = null;
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

// ── Caption selectors ─────────────────────────────────────────
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

// ── MutationObserver ──────────────────────────────────────────
function startCaptionObserver(container) {
  const observer = new MutationObserver(() => processCaptionChange());
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

// ── Polling fallback (catches mutations that the observer misses) ──
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (config.enabled) processCaptionChange();
  }, 250);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── Core caption processing (called by both observer and poll) ──
function processCaptionChange() {
  const text = readCaptionText();
  if (!text) return;

  const now = Date.now();
  if (now - lastCueTime < 250) return; // debounce
  if (text === lastCueText) return;    // exact duplicate

  const prev = lastCueText;
  lastCueText = text;
  lastCueTime = now;

  // Extract only the new words if this is a growing cue
  const toTranslate = extractNewPart(prev, text) ?? text;

  // Skip if too similar to what we already said
  if (isTooSimilar(lastSpokenText, toTranslate)) return;

  // Pre-fetch translation immediately — don't wait
  prefetchAndSpeak(toTranslate, now);
}

// ── Overlap / repeat detection ────────────────────────────────
function isTooSimilar(prev, next) {
  if (!prev || !next) return false;
  const a = normalise(prev);
  const b = normalise(next);
  if (a === b) return true;
  if (b.startsWith(a)) return true;
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

function extractNewPart(prev, next) {
  if (!prev) return next;
  const a = normalise(prev);
  const b = normalise(next);
  if (b.startsWith(a)) {
    const remainder = next.slice(prev.trim().length).trim();
    return remainder.length > 2 ? remainder : null;
  }
  return next;
}

// ── Pre-fetch + speak ─────────────────────────────────────────
// Fire translation immediately. If we're already speaking, the result
// will be ready to play the moment the current utterance ends.
function prefetchAndSpeak(text, timestamp) {
  const promise = translate(text, config.targetLang);

  // Store as the latest pending — any older pending is now irrelevant
  pendingTranslation = { text, promise, timestamp };

  promise.then((translated) => {
    if (!translated) return;
    // Make sure this is still the most recent thing we care about
    if (pendingTranslation?.timestamp !== timestamp) return;
    // Drop if too stale
    if (Date.now() - timestamp > 2000) return;

    pendingTranslation = null;

    if (!isSpeaking) {
      speak(translated);
    } else {
      // Store as next-up — will be played when current utterance ends
      pendingTranslation = { text, translated, timestamp, ready: true };
    }
  }).catch(err => {
    console.error('[YT Translator] Translation error:', err);
  });
}

// ── Translation ───────────────────────────────────────────────
async function translate(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translate failed: ${res.status}`);
  const data = await res.json();
  return data[0].map(item => item[0]).filter(Boolean).join('');
}

// ── Speech ────────────────────────────────────────────────────
function speak(text) {
  const video = getVideo();
  if (video?.paused) return;

  isSpeaking = true;
  lastSpokenText = text;

  const utt = new SpeechSynthesisUtterance(text);
  utt.voice  = getVoice();
  utt.rate   = (video?.playbackRate ?? 1) * config.voiceRate;
  utt.volume = config.voiceVolume;
  utt.lang   = config.targetLang;

  utt.onend = () => {
    // If a pre-fetched translation is already ready, play it immediately
    if (pendingTranslation?.ready) {
      const next = pendingTranslation;
      pendingTranslation = null;
      speak(next.translated);
    } else {
      isSpeaking = false;
    }
  };

  utt.onerror = () => {
    isSpeaking = false;
  };

  window.speechSynthesis.speak(utt);
}

// ── SPA navigation ────────────────────────────────────────────
function listenForNavigation() {
  document.addEventListener('yt-navigate-finish', () => {
    captionObserver?.disconnect();
    captionObserver = null;
    stopPolling();
    window.speechSynthesis.cancel();
    pendingTranslation = null;
    isSpeaking = false;
    lastCueText = '';
    lastSpokenText = '';
    attachVideoListeners();
    applyMuteOriginal();
    tryEnableCaptions();
    waitForCaptionContainer((container) => {
      captionObserver = startCaptionObserver(container);
      startPolling();
    });
  });
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
    pendingTranslation = null;
    isSpeaking = false;
  }
});
