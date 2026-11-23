export type Status = 'busy' | 'idle' | 'waiting' | 'done';

export type RoleId =
  | 'builder' | 'detective' | 'critic' | 'lab' | 'archivist' | 'poet'
  | 'artist' | 'strategist' | 'janitor' | 'doctor' | 'guard' | 'secretary'
  | 'lead' | 'intern';

export type SkillCategory =
  | 'ideas' | 'planning' | 'debugging' | 'review' | 'testing'
  | 'git' | 'writing' | 'design' | 'running' | 'other';

export interface ActiveSkill {
  name: string;
  category: SkillCategory;
  since: number;
}

export interface Agent {
  id: string;
  kind: 'lead' | 'sub';
  name: string;
  description: string;
  role: RoleId;
  status: Status;
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
  parentId?: string;
  activeSkill?: ActiveSkill;
  runs?: number;
  recentTasks?: string[];
}

export interface Room {
  id: string;
  label: string;
  cwd: string;
  branch?: string;
  ended?: boolean;
  agents: Agent[];
}

export interface Floor {
  id: string;
  label: string;
  rooms: Room[];
}

export interface Snapshot {
  generatedAt: number;
  floors: Floor[];
}
