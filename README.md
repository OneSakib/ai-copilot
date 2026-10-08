# AI Copilot

A floating overlay that listens to your mic **and** the other side's audio, transcribes both
live, and streams reply suggestions written from your own background notes.

Stack: Electron overlay · Next.js UI · FastAPI WebSocket backend (bundled as an exe) ·
Deepgram streaming speech-to-text · LangGraph · Anthropic Claude.

## For users (Windows)
1. Run `AI Copilot Setup.exe`. It installs and opens the app (no Python or Node needed).
2. Accept the notice, paste your Anthropic and Deepgram API keys. Keys are stored encrypted on that PC.
3. The app starts listening automatically. Open **Notes** and add your background.

Windows may show a "SmartScreen" warning for unsigned apps: click *More info → Run anyway*.
(Remove it for good by signing the installer with a code-signing certificate.)

| Keys | Action |
|---|---|
| Ctrl+Alt+H | show / hide overlay |
| Ctrl+Alt+A | suggest a reply now |
| Ctrl+Alt+S | screenshot your screen and get an answer |
| Ctrl+Alt+L | start / stop listening |
| Ctrl+Alt+M | click-through mode |
| Ctrl+Alt+P | toggle screen-capture shield |
| Ctrl+Alt+Shift + arrows | move window |

(On Mac, Ctrl is Cmd and Alt is Option.) If another app already uses a key, the footer shows it
struck through and the buttons still work. To change a key, tray icon → *Open settings folder*,
edit `settings.json` and add e.g. `"shortcuts": { "screenshot": "Ctrl+Alt+K" }`, then restart.

The overlay has no taskbar button. Use the tray icon (bottom-right) to quit.
Use headphones so the mic doesn't re-capture the other side's voice.

## Screenshot
The **Screenshot** button (or Ctrl+Alt+S) grabs your screen, sends it to Claude with the
conversation so far, and streams back an answer (interview question, coding problem,
multiple choice...). It is taken straight from the OS: no shutter sound, no flash, no window
is hidden, and nothing is saved to disk. The image is sent to Anthropic for that one request.

## Build the Windows installer

**Option A: GitHub Actions (no setup on your PC)**
1. Push this folder to a GitHub repo.
2. Actions tab → *Build Windows installer* → **Run workflow**.
3. Download `AI-Copilot-Windows` from the finished run. It contains the `.exe` installer.

**Option B: on a Windows PC** (needs Node 20+ and Python 3.11+)
```bash
pip install -r backend/requirements.txt
npm install
npm run dist:win        # installer appears in ./dist
```

## Develop
```bash
cd backend && python -m venv .venv && .venv\Scripts\activate   # (source .venv/bin/activate on Mac)
pip install -r requirements.txt
copy .env.example .env      # add keys   (cp on Mac)
uvicorn main:app --port 8000
# in another terminal, project root:
npm install && npm run dev
```
Dev mode skips the notice/key screens and reads keys from `backend/.env`.
Set `COPILOT_ONBOARD=1` to test those screens.

## Notes
- System audio: Windows 10/11 uses WASAPI loopback (everything playing through your default
  output). On Mac, macOS 13+ with Screen Recording permission.
- The capture shield (`setContentProtection`) behaves differently across OS versions and
  capture apps. Test with your own recording.
- Each user pays for their own API usage. To sell it as a service instead, host the backend
  yourself and add accounts and billing.
- Many interviews, exams and workplaces prohibit undisclosed AI help or recording. Know the
  rules and recording-consent laws that apply to you.
