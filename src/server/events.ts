import type { Status } from '../shared/types.js';
import { WAITING_TOOLS } from './discovery/transcript.js';

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  notification_type?: string;
  message?: string;
  tool_name?: string;
  agent_id?: string;
  agent_type?: string;
}

const MAX_SESSIONS = 1000;
const WAITING_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog']);
const IDLE_MESSAGE = /waiting for your input/i;

function notificationStatus(e: HookEvent): Status | null {
  const t = e.notification_type;
  if (typeof t === 'string' && t) {
    if (WAITING_NOTIFICATIONS.has(t)) return 'waiting';
    if (t === 'idle_prompt') return 'idle';
    return null; // unknown/other types (auth, etc.): no state change
  }
  // Older Claude Code versions send no notification_type: fall back to the message text.
  return IDLE_MESSAGE.test(e.message ?? '') ? 'idle' : 'waiting';
}

function mapStatus(e: HookEvent): Status | null | 'drop' {
  switch (e.hook_event_name) {
    case 'UserPromptSubmit':
      return 'busy';
    case 'PreToolUse':
      return typeof e.tool_name === 'string' && WAITING_TOOLS.has(e.tool_name) ? 'waiting' : 'busy';
    case 'Stop':
      return 'idle';
    case 'Notification':
      return notificationStatus(e);
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
