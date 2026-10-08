"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { HTTP_URL, useCopilot } from "@/hooks/useCopilot";

function Notes({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${HTTP_URL}/context`).then((r) => r.json()).then((d) => setText(d.text)).catch(() => {});
  }, []);

  const save = async () => {
    await fetch(`${HTTP_URL}/context`, {
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
  const { status, error, lines, partials, answers, start, stop, ask, clear } = useCopilot();
  const [notes, setNotes] = useState(false);
  const [passThrough, setPassThrough] = useState(false);
  const [protectedOn, setProtectedOn] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const a = window.copilot?.onClickThrough(setPassThrough);
    const b = window.copilot?.onProtected(setProtectedOn);
    return () => {
      a?.();
      b?.();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, partials]);

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
        <button className="ghost" onClick={clear}>Clear</button>
        <button onClick={live ? stop : start}>{live ? "Stop" : "Start"}</button>
      </header>

      {notes && <Notes onClose={() => setNotes(false)} />}

      {error && <div className="error">{error}</div>}

      <section className="answer">
        {latest ? (
          <div className={`card ${latest.done ? "" : "streaming"}`}>
            {latest.trigger && <div className="trigger">{latest.trigger}</div>}
            <ReactMarkdown>{latest.text}</ReactMarkdown>
          </div>
        ) : (
          <p className="empty">
            {live
              ? "Listening. A suggestion appears when they ask you something, or press ⌘⇧↩ to ask now."
              : "Press Start. Your mic and the other side's audio are transcribed live."}
          </p>
        )}
        {live && (
          <button className="askbtn" onClick={ask}>Suggest a reply</button>
        )}
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
        <span>⌘⇧Space show/hide</span>
        <span>⌘⇧L start/stop</span>
        <span>⌘⇧M click-through{passThrough ? " (on)" : ""}</span>
        <span>⌘⇧P capture shield {protectedOn ? "on" : "off"}</span>
        <span>⌘⇧←↑↓→ move</span>
      </footer>
    </main>
  );
}
