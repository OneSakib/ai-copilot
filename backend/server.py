"""Entry point used by the packaged app (PyInstaller)."""
import os

import uvicorn

from main import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("COPILOT_PORT", "18765")),
        log_level="warning",
    )
