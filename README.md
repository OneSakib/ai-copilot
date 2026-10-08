# AI Copilot (Mac)

A floating overlay that listens to your mic **and** the other side's audio, transcribes
both live, and streams reply suggestions written from your own background notes.

**Stack:** Electron (transparent always-on-top window) · Next.js UI · FastAPI WebSocket
backend · Deepgram streaming STT · LangGraph pipeline · Anthropic Claude.

```
mic (ch 0) ─┐                                   ┌─ partial / utterance ─┐
            ├─ AudioWorklet 16 kHz PCM ─ WS ─►  │ FastAPI ─ Deepgram x2 │ ─► overlay
system (ch 1)┘                                  │   └ LangGraph: classify → answer (streamed)
```

## 1. Backend
```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # add ANTHROPIC_API_KEY and DEEPGRAM_API_KEY
uvicorn main:app --host 127.0.0.1 --port 8000
```
(or `npm run backend` from the project root, with the venv active)
Edit `backend/context.md` (or use **Notes** in the overlay) with your resume / talking points.

## 2. Overlay app
```bash
npm install
npm run dev        # starts Next.js on :3000 and opens the Electron overlay
```

## 3. macOS permissions (first run)
System Settings → Privacy & Security → grant **Microphone** and **Screen & System Audio
Recording** to Electron (or your terminal while in dev), then restart `npm run dev`.
System-audio capture needs **macOS 13+**. Use headphones so the mic doesn't re-capture
the other side's voice.

## Shortcuts
| Keys | Action |
|---|---|
| ⌘⇧Space | show / hide overlay |
| ⌘⇧L | start / stop listening |
| ⌘⇧↩ | suggest a reply now |
| ⌘⇧M | click-through mode (mouse passes to the app underneath) |
| ⌘⇧P | toggle screen-capture shield |
| ⌘⇧ + arrows | move window |

## Notes
- The capture shield (`setContentProtection`) behaves differently across macOS versions
  and capture apps. Test with your own recording before relying on it.
- Deepgram handles speech-to-text because Claude doesn't transcribe audio. Set
  `STT_LANGUAGE` in `.env` (e.g. `en`, `en-IN`, `hi`).
- Models are set in `.env` (`MAIN_MODEL`, `FAST_MODEL`).
- Be upfront where it matters: many interviews, exams and workplaces prohibit
  undisclosed AI help or recording. Check the rules and consent laws that apply to you.
