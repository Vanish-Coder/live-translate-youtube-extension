# YT Live Translator — Chrome Extension

Reads YouTube captions in real-time, translates them via Google Translate, and speaks the translation aloud. **No API key or account required.**

---

## Installation

1. Unzip this folder somewhere on your computer.
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the `yt-translator` folder.
5. The extension icon appears in your toolbar.

---

## Setup

1. Go to any YouTube video.
2. **Enable captions** on the video — press `C` or click the CC button.
3. Click the extension icon in the toolbar.
4. Select your **target language** (default: English).
5. Pick a voice, adjust rate and volume if needed.
6. Toggle the extension **ON**.

That's it — no API key, no account, no billing.

---

## How it works

| File | Role |
|---|---|
| `manifest.json` | Extension config, permissions, content script declaration |
| `content.js` | Injected into YouTube — watches caption DOM, translates, speaks |
| `popup.html/js` | The extension popup UI |
| `background.js` | Service worker — sets defaults on install |

### Flow
```
YouTube caption DOM
  → MutationObserver (content.js)
    → translate.googleapis.com (unofficial, no key)
      → Web Speech API (speechSynthesis.speak)
```

---

## Notes

- **Captions must be enabled** on the video. The extension reads YouTube's own caption rendering — it does not generate captions from audio.
- If speech falls behind the video, older cues are automatically dropped to stay in sync.
- The Chrome speech synthesis engine has a 15-second bug where it silently stops. The extension works around this with a keepalive ping every 10 seconds.
- The unofficial translate endpoint is widely used and reliable for personal use, but is not a supported Google API — it could theoretically be rate-limited if abused.
