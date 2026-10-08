"""Bundle the backend into a single executable:  python build.py
Output: backend/dist/copilot-backend(.exe)"""
import os

import PyInstaller.__main__ as pyi

os.chdir(os.path.dirname(os.path.abspath(__file__)))

args = ["server.py", "--onefile", "--noconfirm", "--clean", "--name", "copilot-backend"]
for pkg in ("uvicorn", "websockets", "langgraph", "langchain_core", "langchain_anthropic", "anthropic"):
    args += ["--collect-all", pkg]
pyi.run(args)
