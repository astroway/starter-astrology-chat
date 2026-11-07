import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type AstroTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  credits: number | null;
};

const MCP_URL = process.env.ASTROWAY_MCP_URL || 'https://mcp.astroway.info/mcp/core';

// The tools a model sees by default. A domain server lists about a hundred, and
// every one of them is read on every turn, so the default is the few a chat needs.
const DEFAULT_TOOLS = [
  'astroway_western_chart',
  'astroway_western_planets',
  'astroway_horoscope_daily',
  'astroway_calendar_moon_phase',
  'astroway_calendar_retrograde_periods',
  'astroway_cost_estimate',
];

function allowedTools(): string[] | 'all' {
  const raw = (process.env.ASTROWAY_TOOLS || '').trim();
  if (raw === '*') return 'all';
  if (!raw) return DEFAULT_TOOLS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function connect(): Promise<Client> {
  const key = process.env.ASTROWAY_API_KEY;
  if (!key) throw new Error('ASTROWAY_API_KEY is not set. Get a free key at https://api.astroway.info/dashboard/sign-up');
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: 'astroway-starter-astrology-chat', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

let cache: { at: number; tools: AstroTool[] } | null = null;

export async function listTools(client: Client): Promise<AstroTool[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.tools;
  const allow = allowedTools();
  const out: AstroTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    for (const t of page.tools) {
      if (allow !== 'all' && !allow.includes(t.name)) continue;
      // The price is the last line of every description, e.g. "[Cost: 20 credits (Tier 2)]".
      const m = /\[Cost:\s*(\d+)\s*credits?/i.exec(t.description || '');
      const { $schema: _drop, ...schema } = t.inputSchema as Record<string, unknown>;
      out.push({ name: t.name, description: t.description || '', inputSchema: schema, credits: m ? Number(m[1]) : null });
    }
    cursor = page.nextCursor;
  } while (cursor);
  if (out.length === 0) throw new Error(`None of the tools in ASTROWAY_TOOLS exist on ${MCP_URL}`);
  cache = { at: Date.now(), tools: out };
  return out;
}

const MAX_RESULT_CHARS = 16_000;

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const ANGLES = ['ascendant', 'mc', 'vertex', 'descendant', 'ic'];
const signOf = (lon: number) => {
  const l = ((lon % 360) + 360) % 360;
  // Degrees and minutes as text: given 21.62 a model writes 21°62'.
  const totalMin = Math.floor((l % 30) * 60);
  const d = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { sign: SIGNS[Math.floor(l / 30)], degree: `${d}°${String(m).padStart(2, '0')}′` };
};

// Models get longitude-to-sign arithmetic wrong (Sun at 56.26 came back as Gemini, it is Taurus 26),
// so the sign is added to the result here and the model only has to read it.
function addSigns(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(addSigns);
  if (!v || typeof v !== 'object') return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    o[k] = addSigns(x);
    if (k === 'cusps' && Array.isArray(x) && x.every((c) => typeof c === 'number')) {
      o.cuspSigns = (x as number[]).map((c) => signOf(c).sign);
    }
    if (typeof x === 'number' && ANGLES.includes(k)) {
      const s = signOf(x);
      o[`${k}Sign`] = s.sign;
      o[`${k}DegreeInSign`] = s.degree;
    }
  }
  if (typeof o.longitude === 'number' && o.sign === undefined) {
    const s = signOf(o.longitude);
    o.sign = s.sign;
    o.degreeInSign = s.degree;
  }
  return o;
}

function withSigns(text: string): string {
  try {
    return JSON.stringify(addSigns(JSON.parse(text)));
  } catch {
    return text;
  }
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const content = Array.isArray(res.content) ? res.content : [];
  let text = content
    .map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text ?? '' : `[${c.type} omitted]`))
    .join('\n');
  if (!res.isError) text = withSigns(text);
  // A result past this size costs more model tokens than it earns; the model is told to ask with `fields`.
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS) + `\n[truncated at ${MAX_RESULT_CHARS} characters: call again with "fields" naming only the paths you need]`;
  }
  return { ok: !res.isError, text };
}
