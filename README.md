# Youtube Live Translator
In a nutshell, this extension reads Youtube captions (doesn't matter the language), translates them (via Google Translate), and speaks the translation out loud using the browser's default voice.

## Installation 
- Install a [release](https://github.com/Vanish-Coder/live-translate-youtube-extension/releases) (the latest one usually gives the best results).
- Go to chrome://extensions/.
- Enable Developer mode (at the top right).
- Press on the "Load unpacked" button (at the top left).
- This will open a file selector, simply select the folder you just downloaded (should be called "youtube-live-translator).
- You now have the extension installed. You can [pin it](https://support.google.com/chrome/a/answer/11190170?hl=en) for ease of access.

## Setup
- Go to any Youtube video and **enable captions** (super important step). The captions can be in any language, though the language that the video is in is often the best to avoid double translation errors.
- Open the extension. You should see something like [this](https://drive.google.com/file/d/1neGENM4pDDIYeCEBO2m7xu5CabeceDMc/view?usp=sharing). 
- Make sure the toggle switch is on.
- Select the target language (the language you want the video translated in).
- **Side Notes**: You can pick a voice (in beta), adjust volume and speech rate, and mute the original audio.

## What makes this different from other translator extensions/autodub?
Most Youtube translation extensions rely on either a LLM (AI) or some sort of paid API, which causes higher latency and limited usage at free tiers. This extension approaches this whole idea in a different way, allowing for a zero-cost solution which is carried on to the users. Also, as of now, Youtube autodub isn't available for around 99% of youtube videos (data drawn from [here](https://www.google.com/search?q=how+many+youtube+videos+have+autodub&rlz=1C5OZZY_enUS1175US1175&oq=how+many+youtube+videos+have+autodub&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIHCAEQABiABDIHCAIQABiABDIHCAMQABiABDIHCAQQABiABDIHCAUQABiABDIHCAYQABiABDIHCAcQABiABDIHCAgQABiABDIHCAkQABiABNIBCDUzMjFqMGo3qAIAsAIA&sourceid=chrome&ie=UTF-8&mstk=AUtExfCw92zok3Q-Hi3g-vBeVZFO5Dg0zR_-WhjpVKfWfXwbEUp5cHg3o29HQItt1K39yQoRSpSe_hyVIaTJNS1tCnBBWIksWNMIWX1hXANm4jb3Qri5m-PHguIUHMjb9qnQoTBM77j79eDEj0X5UaC0EsuYkiKPf0kebm0eEMa1_E2HWafMopsPxi52fBLNN68a5dQmdnOfyb_3RLfCtjCWkMG1VJE_gQ&csuir=1&udm=50&aioh=3#aof=1) and [here](https://share.google/aimode/Mrv8u8KZ7MIiJU42y)).

## Extra Notes
- This extension is in beta, so it often misses cues and thus may not say every word.
- This extension may get ratelimited in certain scenarios, though I don't see that happening.
