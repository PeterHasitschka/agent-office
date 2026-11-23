import type { Status } from '../shared/types.js';

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  notification_type?: string;
  message?: string;
  agent_id?: string;
  agent_type?: string;
}

const MAX_SESSIONS = 1000;

function mapStatus(e: HookEvent): Status | null | 'drop' {
  switch (e.hook_event_name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
      return 'busy';
    case 'Stop':
      return 'idle';
    case 'Notification':
      return e.notification_type === 'idle_prompt' || /waiting for your input/i.test(e.message ?? '')
        ? 'idle'
        : 'waiting';
    case 'SessionEnd':
      return 'drop';
    default:
      return null;
  }
}

/** Latest plugin hook event per session; overrides the transcript heuristic when fresh. */
export class EventStore {
  private state = new Map<string, { status: Status; at: number }>();
  private cbs: Array<() => void> = [];

  ingest(e: HookEvent, now: number): void {
    if (!e || typeof e.session_id !== 'string' || !e.session_id || typeof e.hook_event_name !== 'string') return;
    const m = mapStatus(e);
    if (m === null) return;
    if (m === 'drop') {
      if (!this.state.delete(e.session_id)) return;
    } else {
      this.state.delete(e.session_id); // re-insert so Map order = recency
      this.state.set(e.session_id, { status: m, at: now });
      while (this.state.size > MAX_SESSIONS) {
        const oldest = this.state.keys().next().value as string;
        this.state.delete(oldest);
      }
    }
    for (const cb of this.cbs) cb();
  }

  overrideFor(sessionId: string, transcriptMtimeMs: number): Status | null {
    const s = this.state.get(sessionId);
    return s && s.at >= transcriptMtimeMs - 1000 ? s.status : null;
  }

  onChange(cb: () => void): void {
    this.cbs.push(cb);
  }
}
