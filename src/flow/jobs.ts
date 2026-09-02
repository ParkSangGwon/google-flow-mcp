import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type JobKind = 'video' | 'image' | 'scene_extend' | 'scene_jump';
export type JobPhase = 'sending' | 'sent' | 'done' | 'failed';

export interface Job {
  job_id: string;
  kind: JobKind;
  phase: JobPhase;
  created_at: string;
  updated_at: string;
  project_url: string;
  scene_url?: string;
  output_dir: string;
  prompt: string;
  model: string;
  baseline_media_ids: string[];
  expected_clip_index?: number;
  result?: Record<string, unknown>;
  error?: string;
}

// Job records live on disk so a restarted server can resume (or dedupe) a generation that is already running
export class JobStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  create(init: Omit<Job, 'job_id' | 'created_at' | 'updated_at'>): Job {
    const now = new Date().toISOString();
    const job: Job = { ...init, job_id: newJobId(), created_at: now, updated_at: now };
    this.write(job);
    return job;
  }

  update(id: string, patch: Partial<Omit<Job, 'job_id' | 'created_at'>>): Job {
    const job = this.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    const next: Job = { ...job, ...patch, updated_at: new Date().toISOString() };
    this.write(next);
    return next;
  }

  get(id: string): Job | undefined {
    const file = this.file(id);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Job;
    } catch {
      return undefined;
    }
  }

  list(): Job[] {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.get(f.slice(0, -5)))
      .filter((j): j is Job => j !== undefined)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  inFlight(): Job[] {
    return this.list().filter((j) => j.phase === 'sending' || j.phase === 'sent');
  }

  findLatest(pred: (job: Job) => boolean): Job | undefined {
    return this.list().find(pred);
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private write(job: Job): void {
    fs.writeFileSync(this.file(job.job_id), JSON.stringify(job, null, 2));
  }
}

function newJobId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}
