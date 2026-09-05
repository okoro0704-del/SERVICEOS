export type JobEnqueueInput = {
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  delayMs?: number;
};

export type JobEnqueueResult = {
  jobId: string;
  status: "queued" | "scheduled";
};

/**
 * Primitive #4 — Platform Jobs Engine (Background processing, queues, ETA).
 */
export interface IJobDispatcher {
  readonly primitiveId: "platform-jobs";
  readonly bound: boolean;
  health(): Promise<{ ok: boolean; service?: string }>;
  enqueue(input: JobEnqueueInput): Promise<JobEnqueueResult>;
  getStatus(jobId: string): Promise<{ jobId: string; status: string }>;
}

export type IJobsProvider = IJobDispatcher;
