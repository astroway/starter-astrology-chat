import type { AstroTool } from './astroway';

export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

// Any OpenAI-compatible chat completions endpoint: OpenAI, Groq, OpenRouter, Together, Mistral, a local Ollama.
const BASE_URL = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// Free model tiers cap tokens per minute, and one chat turn is two or three requests.
// A short wait is better than an error; a long one is returned as the error it is.
async function postWithRetry(url: string, key: string, body: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body,
    });
    const wait = Number(res.headers.get('retry-after'));
    if (res.status !== 429 || attempt >= 2 || !(wait > 0 && wait <= 20)) return res;
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

export async function complete(messages: Msg[], tools: AstroTool[]) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY is not set');
  const res = await postWithRetry(`${BASE_URL}/chat/completions`, key, JSON.stringify({
    model: MODEL,
    messages,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
          tool_choice: 'auto',
        }
      : {}),
    temperature: 0.4,
  }));
  if (!res.ok) {
    // The provider's own message says why; pass it on rather than guessing.
    const body = await res.text();
    throw new Error(`Model request failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('Model returned no message');
  return msg as { content: string | null; tool_calls?: ToolCall[] };
}
