// ============================================================
//  YT Live Translator — background.js
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (existing) => {
    const defaults = {
      enabled: false,
      targetLang: 'en',
      voiceRate: 1.0,
      voiceVolume: 1.0,
      selectedVoiceName: '',
      muteOriginal: false,
    };
    const toSet = {};
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in existing)) toSet[k] = v;
    }
    if (Object.keys(toSet).length) chrome.storage.sync.set(toSet);
  });
});
