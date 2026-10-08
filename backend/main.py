"""FastAPI server: audio in over WebSocket -> STT -> LangGraph -> streamed suggestions out.

Binary frames from the client:  [1 byte channel][PCM16 LE, 16 kHz, mono]
    channel 0 = me (microphone), channel 1 = them (system audio)
JSON frames from the client:    {"type": "ask"} | {"type": "clear"} | {"type": "screenshot", "image": <base64 JPEG>}
"""
import asyncio
import json
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
from graph import graph, text_of
from stt import DeepgramStream

app = FastAPI(title="AI Copilot")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class ContextBody(BaseModel):
    text: str


@app.get("/health")
async def health():
    return {
        "ok": True,
        "anthropic": bool(config.ANTHROPIC_API_KEY),
        "deepgram": bool(config.DEEPGRAM_API_KEY),
    }


@app.get("/context")
async def get_context():
    return {"text": config.load_context()}


@app.post("/context")
async def set_context(body: ContextBody):
    config.save_context(body.text)
    return {"ok": True}


SPEAKERS = {0: "me", 1: "them"}


class Session:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.transcript: list[dict] = []
        self.buffers = {"me": [], "them": []}
        self.streams: dict[str, DeepgramStream] = {}
        self.answer_task: asyncio.Task | None = None

    async def send(self, payload: dict) -> None:
        try:
            await self.ws.send_text(json.dumps(payload))
        except Exception:
            pass

    async def start(self) -> None:
        for speaker in SPEAKERS.values():
            stream = DeepgramStream(
                config.DEEPGRAM_API_KEY,
                config.STT_LANGUAGE,
                lambda t, f, s, sp=speaker: self.on_stt(sp, t, f, s),
            )
            await stream.start()
            self.streams[speaker] = stream
        await self.send({"type": "status", "state": "ready"})

    async def on_stt(self, speaker: str, text: str, is_final: bool, speech_final: bool):
        buf = self.buffers[speaker]
        if not is_final:
            await self.send(
                {"type": "partial", "speaker": speaker, "text": " ".join(buf + [text])}
            )
            return
        buf.append(text)
        if speech_final:
            utterance = " ".join(buf).strip()
            buf.clear()
            self.transcript.append({"speaker": speaker, "text": utterance})
            await self.send({"type": "utterance", "speaker": speaker, "text": utterance})
            if speaker == "them":
                self.trigger(utterance, force=False)
        else:
            await self.send(
                {"type": "partial", "speaker": speaker, "text": " ".join(buf)}
            )

    def trigger(self, utterance: str, force: bool, image: str | None = None) -> None:
        if self.answer_task and not self.answer_task.done():
            self.answer_task.cancel()
        self.answer_task = asyncio.create_task(self.run_graph(utterance, force, image))

    async def run_graph(self, utterance: str, force: bool, image: str | None = None) -> None:
        rid = uuid.uuid4().hex[:8]
        started = False
        state = {
            "transcript": list(self.transcript),
            "utterance": utterance,
            "context": config.load_context(),
            "force": force,
        }
        if image:
            state["image"] = image
        try:
            async for chunk, meta in graph.astream(state, stream_mode="messages"):
                if meta.get("langgraph_node") != "answer":
                    continue
                piece = text_of(chunk.content)
                if not piece:
                    continue
                if not started:
                    started = True
                    await self.send({"type": "answer_start", "id": rid, "trigger": utterance})
                await self.send({"type": "answer_delta", "id": rid, "text": piece})
        except asyncio.CancelledError:
            pass
        except Exception as e:  # surface API errors in the UI
            await self.send({"type": "error", "message": str(e)})
        finally:
            if started:
                await self.send({"type": "answer_end", "id": rid})

    async def handle_audio(self, data: bytes) -> None:
        speaker = SPEAKERS.get(data[0])
        if speaker and speaker in self.streams:
            await self.streams[speaker].send(data[1:])

    async def handle_json(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "ask":
            last_them = next(
                (t["text"] for t in reversed(self.transcript) if t["speaker"] == "them"), ""
            )
            self.trigger(last_them, force=True)
        elif kind == "screenshot":
            image = msg.get("image") or ""
            if 0 < len(image) < 8_000_000:  # ~6 MB of JPEG
                self.trigger("Screenshot", force=True, image=image)
            else:
                await self.send({"type": "error", "message": "Screenshot was empty or too large."})
        elif kind == "clear":
            self.transcript.clear()

    async def close(self) -> None:
        if self.answer_task:
            self.answer_task.cancel()
        for s in self.streams.values():
            await s.close()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    if not (config.ANTHROPIC_API_KEY and config.DEEPGRAM_API_KEY):
        await ws.send_text(
            json.dumps({"type": "error", "message": "Missing API keys in backend/.env"})
        )
        await ws.close()
        return
    session = Session(ws)
    try:
        await session.start()
        while True:
            msg = await ws.receive()
            if msg.get("bytes"):
                await session.handle_audio(msg["bytes"])
            elif msg.get("text"):
                await session.handle_json(json.loads(msg["text"]))
            elif msg.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()
