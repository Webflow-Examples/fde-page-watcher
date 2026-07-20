/** Replaceable background execution boundary. The local adapter uses Next's
 * `after()` lifecycle hook; a durable Webflow queue can implement the same
 * interface without changing route/domain logic. */
export interface BackgroundJobRunner {
  enqueue(job: () => Promise<void>): void;
}

export function createAfterJobRunner(schedule: (job: () => Promise<void>) => void): BackgroundJobRunner {
  return { enqueue: schedule };
}
