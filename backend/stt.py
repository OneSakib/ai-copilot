"""Streaming speech-to-text over Deepgram's WebSocket API (one stream per speaker)."""
import asyncio
import json
from typing import Awaitable, Callable
from urllib.parse import urlencode

import websockets

DG_URL = "wss://api.deepgram.com/v1/listen"

# on_result(text, is_final, speech_final)
ResultCb = Callable[[str, bool, bool], Awaitable[None]]


class DeepgramStream:
    def __init__(self, api_key: str, language: str, on_result: ResultCb):
        self.api_key = api_key
        self.language = language
        self.on_result = on_result
        self.ws = None
        self._reader: asyncio.Task | None = None

    async def start(self) -> None:
        params = {
            "model": "nova-2",
            "language": self.language,
            "encoding": "linear16",
            "sample_rate": 16000,
            "channels": 1,
            "punctuate": "true",
            "smart_format": "true",
            "interim_results": "true",
            "endpointing": 600,  # ms of silence that ends an utterance
        }
        self.ws = await websockets.connect(
            f"{DG_URL}?{urlencode(params)}",
            additional_headers={"Authorization": f"Token {self.api_key}"},
            max_size=None,
        )
        self._reader = asyncio.create_task(self._read())

    async def send(self, pcm: bytes) -> None:
        if self.ws:
            try:
                await self.ws.send(pcm)
            except websockets.ConnectionClosed:
                pass

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if msg.get("type") != "Results":
                    continue
                alts = msg.get("channel", {}).get("alternatives", [])
                text = (alts[0].get("transcript", "") if alts else "").strip()
                if not text:
                    continue
                await self.on_result(
                    text, bool(msg.get("is_final")), bool(msg.get("speech_final"))
                )
        except websockets.ConnectionClosed:
            pass

    async def close(self) -> None:
        if self.ws:
            try:
                await self.ws.send(json.dumps({"type": "CloseStream"}))
                await self.ws.close()
            except Exception:
                pass
        if self._reader:
            self._reader.cancel()
