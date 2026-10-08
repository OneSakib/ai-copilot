import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")
MAIN_MODEL = os.environ.get("MAIN_MODEL", "claude-sonnet-5-5")
FAST_MODEL = os.environ.get("FAST_MODEL", "claude-haiku-4-5-20251001")
STT_LANGUAGE = os.environ.get("STT_LANGUAGE", "en")
CONTEXT_FILE = Path(__file__).parent / "context.md"


def load_context() -> str:
    return CONTEXT_FILE.read_text(encoding="utf-8") if CONTEXT_FILE.exists() else ""


def save_context(text: str) -> None:
    CONTEXT_FILE.write_text(text, encoding="utf-8")
