// ============================================================
//  YT Live Translator — popup.js
// ============================================================

const $ = id => document.getElementById(id);

const els = {
  toggle:       $('main-toggle'),
  toggleLabel:  $('toggle-label'),
  statusDot:    $('status-dot'),
  statusText:   $('status-text'),
  mainBody:     $('main-body'),
  targetLang:   $('target-lang'),
  voiceSelect:  $('voice-select'),
  voiceRate:    $('voice-rate'),
  rateVal:      $('rate-val'),
  voiceVolume:  $('voice-volume'),
  volVal:       $('vol-val'),
  muteOriginal: $('mute-original'),
  queueCount:   $('queue-count'),
};

let config = {
  enabled: false,
  targetLang: 'en',
  voiceRate: 1.0,
  voiceVolume: 1.0,
  selectedVoiceName: '',
  muteOriginal: false,
};

// ── Boot ─────────────────────────────────────────────────────
chrome.storage.sync.get(null, (data) => {
  Object.assign(config, data);
  populateVoices();
  applyConfigToUI();
  updateStatusUI();
});

// ── Voices ───────────────────────────────────────────────────
function populateVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) renderVoices(voices);
  else window.speechSynthesis.addEventListener('voiceschanged', () => {
    renderVoices(window.speechSynthesis.getVoices());
  }, { once: true });
}

function renderVoices(voices) {
  els.voiceSelect.innerHTML = '<option value="">— auto (match language) —</option>';
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.name === config.selectedVoiceName) opt.selected = true;
    els.voiceSelect.appendChild(opt);
  });
}

// ── Apply config → UI ─────────────────────────────────────────
function applyConfigToUI() {
  els.toggle.checked       = config.enabled;
  els.targetLang.value     = config.targetLang || 'en';
  els.voiceRate.value      = config.voiceRate;
  els.rateVal.textContent  = `${parseFloat(config.voiceRate).toFixed(1)}×`;
  els.voiceVolume.value    = config.voiceVolume;
  els.volVal.textContent   = `${Math.round(config.voiceVolume * 100)}%`;
  els.muteOriginal.checked = config.muteOriginal;
  els.voiceSelect.value    = config.selectedVoiceName || '';
}

// ── Status UI ─────────────────────────────────────────────────
function updateStatusUI() {
  const on = config.enabled;
  els.toggleLabel.textContent = on ? 'ON' : 'OFF';
  els.statusDot.classList.toggle('active', on);
  els.statusText.textContent = on
    ? `Active — translating to ${langName(config.targetLang)}`
    : 'Disabled — toggle on to start';
  els.mainBody.classList.toggle('disabled', !on);
}

function langName(code) {
  const map = { en:'English', es:'Spanish', fr:'French', de:'German',
    hi:'Hindi', zh:'Chinese', ja:'Japanese', ko:'Korean',
    ar:'Arabic', pt:'Portuguese', ru:'Russian', it:'Italian' };
  return map[code] ?? code;
}

// ── Persist + broadcast ───────────────────────────────────────
function saveAndBroadcast() {
  chrome.storage.sync.set(config);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'UPDATE_CONFIG', config: { ...config } }).catch(() => {});
  });
  updateStatusUI();
}

// ── Event listeners ───────────────────────────────────────────
els.toggle.addEventListener('change', () => {
  config.enabled = els.toggle.checked;
  saveAndBroadcast();
});

els.targetLang.addEventListener('change', () => {
  config.targetLang = els.targetLang.value;
  saveAndBroadcast();
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) renderVoices(voices);
});

els.voiceSelect.addEventListener('change', () => {
  config.selectedVoiceName = els.voiceSelect.value;
  saveAndBroadcast();
});

els.voiceRate.addEventListener('input', () => {
  config.voiceRate = parseFloat(els.voiceRate.value);
  els.rateVal.textContent = `${config.voiceRate.toFixed(1)}×`;
  saveAndBroadcast();
});

els.voiceVolume.addEventListener('input', () => {
  config.voiceVolume = parseFloat(els.voiceVolume.value);
  els.volVal.textContent = `${Math.round(config.voiceVolume * 100)}%`;
  saveAndBroadcast();
});

els.muteOriginal.addEventListener('change', () => {
  config.muteOriginal = els.muteOriginal.checked;
  saveAndBroadcast();
});

// ── Queue counter ─────────────────────────────────────────────
setInterval(() => {
  chrome.storage.session?.get?.('queueLength', (d) => {
    els.queueCount.textContent = d?.queueLength ?? 0;
  });
}, 1000);
