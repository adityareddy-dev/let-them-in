// One place that talks to the model. Every call is logged with its cost in spend/openai.jsonl,
// and a call is refused when the logged total would pass LTI_BUDGET_USD.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// USD per 1M tokens, standard tier, from https://developers.openai.com/api/docs/pricing (read Nov 9 2026).
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
  'gpt-5.5': { input: 5.0, cached: 0.5, output: 30.0 },
};

export const SHOPPER_MODEL = process.env.LTI_SHOPPER_MODEL ?? 'gpt-5.4-mini';
export const FIX_MODEL = process.env.LTI_FIX_MODEL ?? 'gpt-5.5';
export const SPEND_FILE = process.env.LTI_SPEND_FILE ?? 'spend/openai.jsonl';

export interface Usage {
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
}

export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for ${model}, add it to PRICES first`);
  const fresh = u.input_tokens - u.cached_tokens;
  return (fresh * p.input + u.cached_tokens * p.cached + u.output_tokens * p.output) / 1_000_000;
}

export interface SpendLine {
  at: string;
  model: string;
  purpose: string;
  round?: string;
  shopper?: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  usd: number;
}

export function readSpend(file = SPEND_FILE): SpendLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SpendLine);
}

export function totalSpend(file = SPEND_FILE): number {
  return readSpend(file).reduce((a, l) => a + l.usd, 0);
}

function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  const f = process.env.OPENAI_API_KEY_FILE;
  if (f && existsSync(f)) return readFileSync(f, 'utf8').trim();
  throw new Error('set OPENAI_API_KEY or OPENAI_API_KEY_FILE to make model calls');
}

export function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export type Part =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'low' | 'high' | 'auto' };

export interface AskOptions {
  model: string;
  system: string;
  user: Part[];
  schemaName: string;
  schema: object;
  purpose: string;
  round?: string;
  shopper?: string;
  effort?: 'none' | 'low' | 'medium' | 'high';
}

export async function askJson<T>(o: AskOptions): Promise<T> {
  const budget = Number(process.env.LTI_BUDGET_USD ?? '0');
  const spent = totalSpend();
  if (!(budget > 0)) throw new Error('LTI_BUDGET_USD is not set, refusing paid calls');
  if (spent >= budget) throw new Error(`spend ${spent.toFixed(4)} USD reached the budget ${budget} USD`);

  const body = {
    model: o.model,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: o.system }] },
      { role: 'user', content: o.user },
    ],
    reasoning: { effort: o.effort ?? 'low' },
    text: { format: { type: 'json_schema', name: o.schemaName, schema: o.schema, strict: true } },
  };

  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify(body),
    });
    const json: any = await res.json();
    if (!res.ok) {
      lastErr = `${res.status} ${JSON.stringify(json.error ?? json).slice(0, 300)}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(lastErr);
    }
    const usage: Usage = {
      input_tokens: json.usage?.input_tokens ?? 0,
      cached_tokens: json.usage?.input_tokens_details?.cached_tokens ?? 0,
      output_tokens: json.usage?.output_tokens ?? 0,
    };
    const line: SpendLine = {
      at: new Date().toISOString(),
      model: o.model,
      purpose: o.purpose,
      round: o.round,
      shopper: o.shopper,
      ...usage,
      usd: Number(costUsd(o.model, usage).toFixed(6)),
    };
    mkdirSync(dirname(SPEND_FILE), { recursive: true });
    appendFileSync(SPEND_FILE, JSON.stringify(line) + '\n');

    const texts: string[] = (json.output ?? [])
      .filter((item: any) => item.type === 'message')
      .flatMap((item: any) => item.content ?? [])
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text);
    // Sometimes the reply holds more than one JSON object. The first one is the answer.
    for (const t of texts) {
      try {
        return JSON.parse(t) as T;
      } catch {
        const first = firstJsonObject(t);
        if (first) return first as T;
      }
    }
    lastErr = `no JSON in reply: ${texts.join(' | ').slice(0, 200)}`;
  }
  throw new Error(lastErr);
}
