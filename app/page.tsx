"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useCopilot } from "@/hooks/useCopilot";

type Keys = { anthropic: string; deepgram: string };

function Terms({ onAccept, onQuit }: { onAccept: () => void; onQuit: () => void }) {
  return (
    <section className="panel">
      <h1>Before you start</h1>
      <p>
        This app records your microphone and your computer's audio output, turns it into text, and
        sends that text to Deepgram and Anthropic to write suggestions.
      </p>
      <p>
        You are responsible for getting consent from everyone you record, and for following the rules
        of any interview, exam, meeting or workplace. Do not use it where undisclosed AI help or
        recording is prohibited.
      </p>
      <div className="row">
        <button onClick={onAccept}>I understand</button>
        <button className="ghost" onClick={onQuit}>Quit</button>
      </div>
    </section>
  );
}

function Setup({ onSave, onCancel }: { onSave: (k: Keys) => Promise<void>; onCancel?: () => void }) {
  const [anthropic, setA] = useState("");
  const [deepgram, setD] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = anthropic.trim().length > 10 && deepgram.trim().length > 10;

  return (
    <section className="panel">
      <h1>Connect your accounts</h1>
      <p>Keys stay on this computer, encrypted by Windows or macOS.</p>
      <label>
        Anthropic API key
        <input type="password" value={anthropic} onChange={(e) => setA(e.target.value)} placeholder="sk-ant-..." />
      </label>
      <label>
        Deepgram API key
        <input type="password" value={deepgram} onChange={(e) => setD(e.target.value)} placeholder="Deepgram key" />
      </label>
      <p className="hint">Get keys at console.anthropic.com and console.deepgram.com.</p>
      <div className="row">
        <button
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            await onSave({ anthropic: anthropic.trim(), deepgram: deepgram.trim() });
            setBusy(false);
          }}
        >
          {busy ? "Starting…" : "Save and start"}
        </button>
        {onCancel && <button className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </section>
  );
}

function Notes({ httpUrl, onClose }: { httpUrl: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${httpUrl}/context`).then((r) => r.json()).then((d) => setText(d.text)).catch(() => {});
  }, [httpUrl]);

  const save = async () => {
    await fetch(`${httpUrl}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="notes">
      <p className="hint">Your background. Every suggestion is written from this.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="row">
        <button onClick={save}>{saved ? "Saved" : "Save notes"}</button>
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export default function Page() {
  const { cfg, status, error, lines, partials, answers, pending, start, stop, ask, screenshot, clear, saveKeys, acceptTerms } =
    useCopilot();
  const [notes, setNotes] = useState(false);
  const [editKeys, setEditKeys] = useState(false);
  const [passThrough, setPassThrough] = useState(false);
  const [shield, setShield] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    const a = window.copilot?.onClickThrough(setPassThrough);
    const b = window.copilot?.onProtected(setShield);
    return () => {
      a?.();
      b?.();
    };
  }, []);

  // Open the app and it starts listening (needs a user gesture, so Electron supplies one)
  const ready = !!cfg && cfg.accepted && cfg.hasKeys && !editKeys;
  useEffect(() => {
    if (ready && window.copilot && !autoStarted.current) {
      autoStarted.current = true;
      window.copilot.autoStart();
    }
  }, [ready]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, partials]);

  if (!cfg) {
    return (
      <main className="hud">
        <p className="empty centered">Starting…</p>
      </main>
    );
  }

  const keyFor = (label: string) => cfg.shortcuts.find((s) => s.label === label)?.keys ?? "";

  if (!cfg.accepted) {
    return <main className="hud"><Terms onAccept={acceptTerms} onQuit={() => window.copilot?.quit()} /></main>;
  }
  if (!cfg.hasKeys || editKeys) {
    return (
      <main className="hud">
        <Setup
          onSave={async (k) => {
            await saveKeys(k);
            setEditKeys(false);
          }}
          onCancel={cfg.hasKeys ? () => setEditKeys(false) : undefined}
        />
      </main>
    );
  }

  const latest = answers[answers.length - 1];
  const live = status === "listening";

  return (
    <main className={`hud ${passThrough ? "passthrough" : ""}`}>
      <header className="bar">
        <span className={`dot ${status}`} />
        <span className="title">
          {status === "listening" ? "Listening" : status === "connecting" ? "Connecting" : "Copilot"}
        </span>
        <span className="spacer" />
        <button className="ghost" onClick={() => setNotes((v) => !v)}>Notes</button>
        <button className="ghost" onClick={() => setEditKeys(true)}>Keys</button>
        <button className="ghost" onClick={clear}>Clear</button>
        <button onClick={live ? stop : start}>{live ? "Stop" : "Start"}</button>
      </header>

      {notes && <Notes httpUrl={cfg.httpUrl} onClose={() => setNotes(false)} />}
      {error && <div className="error">{error}</div>}
      {cfg.shortcutFailures.length > 0 && (
        <div className="error">
          Another app is using: {cfg.shortcutFailures.join(", ")}. The buttons still work. To change keys,
          use "Open settings folder" in the tray menu.
        </div>
      )}

      <section className="answer">
        {pending && <p className="empty">Reading your screen…</p>}
        {latest ? (
          <div className={`card ${latest.done ? "" : "streaming"}`}>
            {latest.trigger && <div className="trigger">{latest.trigger}</div>}
            <ReactMarkdown>{latest.text}</ReactMarkdown>
          </div>
        ) : (
          <p className="empty">
            {live
              ? `Listening. A suggestion appears when they ask you something, or press ${keyFor("suggest reply")} to ask now.`
              : "Press Start. Your mic and the other side's audio are transcribed live."}
          </p>
        )}
        <div className="askrow">
          {live && <button className="ghost" onClick={ask}>Suggest a reply</button>}
          <button onClick={screenshot}>Screenshot</button>
        </div>
      </section>

      <section className="log" ref={logRef}>
        {lines.map((l) => (
          <p key={l.id} className={l.speaker}>
            <b>{l.speaker === "me" ? "You" : "Them"}</b> {l.text}
          </p>
        ))}
        {(["them", "me"] as const).map(
          (s) =>
            partials[s] && (
              <p key={s} className={`${s} partial`}>
                <b>{s === "me" ? "You" : "Them"}</b> {partials[s]}
              </p>
            )
        )}
      </section>

      <footer className="keys">
        {cfg.shortcuts.map((s) => (
          <span key={s.label} className={s.ok ? "" : "bad"}>
            {s.keys} {s.label}
            {s.label === "click-through" && passThrough ? " (on)" : ""}
            {s.label === "capture shield" ? (shield ? " (on)" : " (off)") : ""}
          </span>
        ))}
      </footer>
    </main>
  );
}
