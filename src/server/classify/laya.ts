import type { RoleId } from '../../shared/types.js';
import type { RoleConfig } from './rules.js';

/**
 * Request/response shape (from the Laya model card; see task notes for live verification):
 *   POST {url}/v1/systemone
 *   { state: string, questions: { role: { type: 'choice', question: string, choices: { <label>: <description> } } } }
 *   -> { answers: { role: { choice: <label>, confidence: number } } }
 */
export class LayaClient {
  private url: string;
  private model?: string;
  private timeoutMs: number;

  constructor(opts: { url: string; model?: string; timeoutMs?: number }) {
    this.url = opts.url.replace(/\/+$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 2000;
  }

  /** GET /health (laya-serve's liveness route); only a 2xx counts as reachable. */
  async probe(): Promise<boolean> {
    try {
      const res = await fetch(this.url + '/health', { signal: AbortSignal.timeout(this.timeoutMs) });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }

  async classify(text: string, cfg: RoleConfig): Promise<{ role: RoleId; confidence: number } | null> {
    const choices: Record<string, string> = {};
    for (const [id, def] of Object.entries(cfg.roles)) choices[id] = def.laya;
    const r = await this.ask(text, 'role', 'Which role best describes this agent?', choices);
    return r && { role: r.choice as RoleId, confidence: r.confidence };
  }

  /** Generic single `choice` question; the answer is guaranteed to be one of `options`' own keys. */
  async classifyChoice(
    text: string,
    options: Record<string, string>,
    question = 'Which option best describes this?',
  ): Promise<{ choice: string; confidence: number } | null> {
    return this.ask(text, 'choice', question, options);
  }

  private async ask(
    text: string,
    key: string,
    question: string,
    choices: Record<string, string>,
  ): Promise<{ choice: string; confidence: number } | null> {
    try {
      const body: Record<string, unknown> = {
        state: text,
        questions: { [key]: { type: 'choice', question, choices } },
      };
      if (this.model) body.model = this.model;
      const res = await fetch(this.url + '/v1/systemone', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      const j: any = JSON.parse(await res.text());
      const a = j?.answers?.[key];
      const label = a?.choice;
      const confidence = Number(a?.confidence);
      if (typeof label !== 'string' || !Object.hasOwn(choices, label) || !Number.isFinite(confidence)) return null;
      return { choice: label, confidence };
    } catch {
      return null;
    }
  }
}
