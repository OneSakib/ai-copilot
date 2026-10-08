"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://127.0.0.1:8000/ws";
export const HTTP_URL = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");

export type Speaker = "me" | "them";
export type Line = { id: number; speaker: Speaker; text: string };
export type Answer = { id: string; trigger: string; text: string; done: boolean };
export type Status = "idle" | "connecting" | "listening" | "error";

declare global {
  interface Window {
    copilot?: {
      onAsk: (cb: () => void) => () => void;
      onToggleListening: (cb: () => void) => () => void;
      onClickThrough: (cb: (on: boolean) => void) => () => void;
      onProtected: (cb: (on: boolean) => void) => () => void;
    };
  }
}

export function useCopilot() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [partials, setPartials] = useState<Partial<Record<Speaker, string>>>({});
  const [answers, setAnswers] = useState<Answer[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const mediaRef = useRef<MediaStream[]>([]);
  const idRef = useRef(0);

  const stop = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    mediaRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    mediaRef.current = [];
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setPartials({});
    setStatus("idle");
  }, []);

  const handle = useCallback((m: any) => {
    switch (m.type) {
      case "partial":
        setPartials((p) => ({ ...p, [m.speaker]: m.text }));
        break;
      case "utterance":
        setPartials((p) => ({ ...p, [m.speaker]: "" }));
        setLines((l) => [...l.slice(-40), { id: ++idRef.current, speaker: m.speaker, text: m.text }]);
        break;
      case "answer_start":
        setAnswers((a) => [...a.slice(-5), { id: m.id, trigger: m.trigger, text: "", done: false }]);
        break;
      case "answer_delta":
        setAnswers((a) => a.map((x) => (x.id === m.id ? { ...x, text: x.text + m.text } : x)));
        break;
      case "answer_end":
        setAnswers((a) => a.map((x) => (x.id === m.id ? { ...x, done: true } : x)));
        break;
      case "error":
        setError(m.message);
        break;
    }
  }, []);

  const attach = useCallback((ctx: AudioContext, stream: MediaStream, channel: 0 | 1, ws: WebSocket) => {
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-processor");
    node.port.onmessage = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const pcm = new Uint8Array(e.data as ArrayBuffer);
      const frame = new Uint8Array(pcm.length + 1);
      frame[0] = channel; // 0 = me (mic), 1 = them (system audio)
      frame.set(pcm, 1);
      ws.send(frame);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0; // keep the graph alive without echoing audio
    src.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
  }, []);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setError("");
    setStatus("connecting");
    try {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      await new Promise<void>((res, rej) => {
        ws.onopen = () => res();
        ws.onerror = () => rej(new Error(`Can't reach the backend at ${WS_URL}. Is it running?`));
      });
      ws.onmessage = (e) => handle(JSON.parse(e.data));
      ws.onclose = () => {
        if (wsRef.current === ws) stop();
      };

      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-worklet.js");

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      display.getVideoTracks().forEach((t) => t.stop());
      const sysTracks = display.getAudioTracks();
      mediaRef.current = [mic, display];
      if (!sysTracks.length) {
        throw new Error("No system audio. Grant Screen Recording permission to Electron and use macOS 13+.");
      }

      attach(ctx, mic, 0, ws);
      attach(ctx, new MediaStream(sysTracks), 1, ws);
      setStatus("listening");
    } catch (err: any) {
      stop();
      setError(err?.message ?? String(err));
      setStatus("error");
    }
  }, [attach, handle, stop]);

  const ask = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "ask" }));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setAnswers([]);
    wsRef.current?.send(JSON.stringify({ type: "clear" }));
  }, []);

  // Global shortcuts coming from Electron
  useEffect(() => {
    const off1 = window.copilot?.onAsk(ask);
    const off2 = window.copilot?.onToggleListening(() => (wsRef.current ? stop() : start()));
    return () => {
      off1?.();
      off2?.();
    };
  }, [ask, start, stop]);

  useEffect(() => stop, [stop]);

  return { status, error, lines, partials, answers, start, stop, ask, clear };
}
