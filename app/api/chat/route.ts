import { NextResponse } from 'next/server';
import { callTool, connect, listTools } from '@/lib/astroway';
import { complete, type Msg } from '@/lib/llm';
import { systemPrompt } from '@/lib/prompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_TOOL_ROUNDS = 5;
const MAX_MESSAGES = 30;
const MAX_CHARS = 4000;

// Every visitor of a public deploy spends your credits, so turns are limited per address.
// In memory, so per server instance: good enough for a demo, use a shared store for more.
const LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 20);
const hits = new Map<string, number[]>();
function limited(ip: string) {
  if (!LIMIT) return false;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3_600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

type ChatIn = { role: 'user' | 'assistant'; content: string };

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (limited(ip)) {
    return NextResponse.json({ error: `This demo allows ${LIMIT} messages an hour. Clone it and run it with your own key for more.` }, { status: 429 });
  }

  let body: { messages?: ChatIn[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON: { "messages": [...] }' }, { status: 400 });
  }
  const history = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'The last message must come from the user' }, { status: 400 });
  }

  const calls: { name: string; credits: number | null; ok: boolean; ms: number }[] = [];
  let client;
  try {
    client = await connect();
    const tools = await listTools(client);
    const price = new Map(tools.map((t) => [t.name, t.credits]));
    const messages: Msg[] = [{ role: 'system', content: systemPrompt(new Date().toISOString().slice(0, 10)) }, ...history];

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // On the last round the model gets no tools, so it has to answer with what it has.
      const msg = await complete(messages, round < MAX_TOOL_ROUNDS ? tools : []);
      if (!msg.tool_calls?.length) {
        return NextResponse.json({ reply: msg.content ?? '', calls });
      }
      messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        const started = Date.now();
        let result: { ok: boolean; text: string };
        if (!price.has(tc.function.name)) {
          result = { ok: false, text: `Unknown tool ${tc.function.name}` };
        } else {
          try {
            result = await callTool(client, tc.function.name, JSON.parse(tc.function.arguments || '{}'));
          } catch (e) {
            result = { ok: false, text: e instanceof Error ? e.message : String(e) };
          }
        }
        calls.push({ name: tc.function.name, credits: price.get(tc.function.name) ?? null, ok: result.ok, ms: Date.now() - started });
        console.log(`[astroway] ${tc.function.name} ${tc.function.arguments} ${result.ok ? 'ok' : `error: ${result.text.slice(0, 300)}`} ${Date.now() - started}ms`);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
      }
    }
    return NextResponse.json({ reply: '', calls });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[chat]', message);
    return NextResponse.json({ error: message, calls }, { status: 502 });
  } finally {
    await client?.close().catch(() => {});
  }
}
