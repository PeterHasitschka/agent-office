import { describe, it, expect, vi } from 'vitest';
import { EventStore, type HookEvent } from '../src/server/events';

const ev = (name: string, extra: Partial<HookEvent> = {}): HookEvent => ({
  hook_event_name: name, session_id: 's1', ...extra,
});

describe('EventStore', () => {
  it('permission notification -> waiting', () => {
    const s = new EventStore();
    s.ingest(ev('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }), 1000);
    expect(s.overrideFor('s1', 500)).toBe('waiting');
  });

  it('idle_prompt notification -> idle', () => {
    const s = new EventStore();
    s.ingest(ev('Notification', { notification_type: 'idle_prompt' }), 1000);
    expect(s.overrideFor('s1', 500)).toBe('idle');
    s.ingest(ev('Notification', { message: 'Claude is waiting for your input' }), 2000);
    expect(s.overrideFor('s1', 500)).toBe('idle');
  });

  it('Stop after Notification -> idle; prompt/tool -> busy', () => {
    const s = new EventStore();
    s.ingest(ev('Notification', { notification_type: 'permission_prompt' }), 1000);
    s.ingest(ev('Stop'), 2000);
    expect(s.overrideFor('s1', 0)).toBe('idle');
    s.ingest(ev('UserPromptSubmit'), 3000);
    expect(s.overrideFor('s1', 0)).toBe('busy');
    s.ingest(ev('Stop'), 3500);
    s.ingest(ev('PreToolUse'), 4000);
    expect(s.overrideFor('s1', 0)).toBe('busy');
  });

  it('event older than transcript mtime -> null (1 s grace)', () => {
    const s = new EventStore();
    s.ingest(ev('Stop'), 10_000);
    expect(s.overrideFor('s1', 11_000)).toBe('idle');
    expect(s.overrideFor('s1', 11_001)).toBeNull();
  });

  it('SessionEnd drops entry; unknown session -> null', () => {
    const s = new EventStore();
    s.ingest(ev('Stop'), 1000);
    s.ingest(ev('SessionEnd'), 2000);
    expect(s.overrideFor('s1', 0)).toBeNull();
    expect(s.overrideFor('nope', 0)).toBeNull();
  });

  it('ignores malformed and unknown events without throwing or firing onChange', () => {
    const s = new EventStore();
    const cb = vi.fn();
    s.onChange(cb);
    s.ingest({ hook_event_name: 'Stop' } as HookEvent, 1);
    s.ingest({ session_id: 'x' } as HookEvent, 1);
    s.ingest(null as unknown as HookEvent, 1);
    s.ingest(ev('SomethingNew'), 1);
    s.ingest(ev('SessionEnd'), 1);
    expect(cb).not.toHaveBeenCalled();
    expect(s.overrideFor('s1', 0)).toBeNull();
  });

  it('onChange fires after state changes', () => {
    const s = new EventStore();
    const cb = vi.fn();
    s.onChange(cb);
    s.ingest(ev('Stop'), 1);
    s.ingest(ev('SessionEnd'), 2);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('caps stored sessions, dropping the oldest', () => {
    const s = new EventStore();
    for (let i = 0; i < 1005; i++) s.ingest({ hook_event_name: 'Stop', session_id: `s${i}` }, i);
    expect(s.overrideFor('s0', 0)).toBeNull();
    expect(s.overrideFor('s1004', 0)).toBe('idle');
  });
});
