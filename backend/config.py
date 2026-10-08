import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
MAIN_MODEL = os.environ.get("MAIN_MODEL", "claude-sonnet-5-5")
FAST_MODEL = os.environ.get("FAST_MODEL", "claude-haiku-4-5-20251001")
STT_LANGUAGE = os.environ.get("STT_LANGUAGE", "en")

# Packaged app: Electron sets COPILOT_DATA_DIR to the per-user app-data folder.
DATA_DIR = Path(os.environ.get("COPILOT_DATA_DIR", Path(__file__).parent))
CONTEXT_FILE = DATA_DIR / "context.md"

DEFAULT_CONTEXT = """# Your background (edit this in Notes)
The assistant reads this before every answer. Add your resume summary,
skills, projects and anything you want it to use.

- Role / experience:
- Key skills:
- Projects:
"""


def load_context() -> str:
    if CONTEXT_FILE.exists():
        return CONTEXT_FILE.read_text(encoding="utf-8")
    return DEFAULT_CONTEXT


def save_context(text: str) -> None:
    CONTEXT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONTEXT_FILE.write_text(text, encoding="utf-8")
