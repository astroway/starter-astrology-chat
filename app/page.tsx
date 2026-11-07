'use client';

import { useEffect, useRef, useState } from 'react';

type Call = { name: string; credits: number | null; ok: boolean; ms: number };
type Turn = { role: 'user' | 'assistant'; content: string; calls?: Call[]; error?: boolean };

const EXAMPLES = [
  'I was born on 15 May 1990 at 14:30 in Kyiv. What does my chart say about me?',
  'What is the Moon doing today?',
  'Which planets are retrograde this month?',
  'Daily horoscope for Leo, please.',
];

// Bold and bullets only, built as React nodes, so model output never reaches the page as HTML.
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

function Rich({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) blocks.push(<ul key={blocks.length}>{items.map((it, i) => <li key={i}>{inline(it)}</li>)}</ul>);
    items = [];
  };
  for (const line of text.split('\n')) {
    const m = /^\s*[-*]\s+(.*)$/.exec(line);
    if (m) {
      items.push(m[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

function toolLabel(name: string) {
  return name.replace(/^astroway_/, '').replace(/_/g, ' ');
}

export default function Page() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [turns, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTurns([...next, { role: 'assistant', content: data.reply || '(no answer)', calls: data.calls }]);
    } catch (e) {
      setTurns([...next, { role: 'assistant', content: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <header className="top">
        <h1>Astrology chat</h1>
        <p>
          Charts calculated by the <a href="https://api.astroway.info">AstroWay API</a> over MCP. The model only writes
          the words.
        </p>
      </header>

      <section className="log" aria-live="polite">
        {turns.length === 0 && (
          <div className="empty">
            <p>Ask about a birth chart, today&apos;s sky or a sign. Try one of these:</p>
            <ul>
              {EXAMPLES.map((ex) => (
                <li key={ex}>
                  <button type="button" onClick={() => send(ex)}>
                    {ex}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className={`turn ${t.role}${t.error ? ' error' : ''}`}>
            {t.calls && t.calls.length > 0 && (
              <ul className="calls" aria-label="AstroWay calls">
                {t.calls.map((c, j) => (
                  <li key={j} className={c.ok ? '' : 'failed'}>
                    {toolLabel(c.name)}
                    {c.credits !== null && <span> {c.credits} cr</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="text">{t.role === 'assistant' && !t.error ? <Rich text={t.content} /> : t.content}</div>
          </article>
        ))}
        {busy && <div className="turn assistant pending">Calculating...</div>}
        <div ref={end} />
      </section>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="msg" className="sr-only">
          Message
        </label>
        <textarea
          id="msg"
          rows={2}
          value={input}
          placeholder="Your birth date, time and place, or a question"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
