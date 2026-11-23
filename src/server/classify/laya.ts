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

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(this.url + '/', { signal: AbortSignal.timeout(this.timeoutMs) });
      await res.body?.cancel();
      return true;
    } catch {
      return false;
    }
  }

  async classify(text: string, cfg: RoleConfig): Promise<{ role: RoleId; confidence: number } | null> {
    try {
      const choices: Record<string, string> = {};
      for (const [id, def] of Object.entries(cfg.roles)) choices[id] = def.laya;
      const body: Record<string, unknown> = {
        state: text,
        questions: {
          role: { type: 'choice', question: 'Which role best describes this agent?', choices },
        },
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
      const a = j?.answers?.role;
      const label = a?.choice;
      const confidence = Number(a?.confidence);
      if (typeof label !== 'string' || !(label in choices) || !Number.isFinite(confidence)) return null;
      return { role: label as RoleId, confidence };
    } catch {
      return null;
    }
  }
}
