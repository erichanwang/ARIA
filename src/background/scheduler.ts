/**
 * Priority task scheduler for the command pipeline: a from-scratch
 * cooperative event loop, not a wrapper around Promise.all/setTimeout(0).
 *
 * Ready tasks sit in a binary min-heap keyed by (priority, sequence), so a
 * lower priority number always runs before a higher one, and tasks with the
 * same priority preserve enqueue order (stable FIFO tie-break). Exactly one
 * task runs at a time: the voice pipeline is inherently serial - one spoken
 * command in flight - so this schedules *when* a stage runs, not how many
 * run concurrently. A plain `while` loop drains the heap by awaiting each
 * task in turn; enqueue() kicks the loop if it is idle.
 *
 * Every run is recorded with its queue wait time (enqueue -> start) and run
 * time (start -> finish) so callers can measure real scheduling latency
 * instead of assuming zero queueing delay.
 */

export type Task = () => void | Promise<void>;

interface Entry {
  priority: number;
  seq: number;
  task: Task;
  enqueuedAt: number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Binary min-heap ordered by (priority, seq). No library, array-backed. */
class MinHeap {
  private items: Entry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: Entry): void {
    this.items.push(entry);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): Entry | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (last !== undefined && this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private less(a: Entry, b: Entry): boolean {
    return a.priority !== b.priority ? a.priority < b.priority : a.seq < b.seq;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.items[i], this.items[parent])) break;
      [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
      i = parent;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.less(this.items[l], this.items[smallest])) smallest = l;
      if (r < n && this.less(this.items[r], this.items[smallest])) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

export interface RunRecord {
  priority: number;
  /** Time the task spent queued before it started running, in ms. */
  waitMs: number;
  /** Time the task spent actually running, in ms. */
  runMs: number;
  error: unknown | null;
}

export class PriorityScheduler {
  private heap = new MinHeap();
  private seq = 0;
  private running = false;
  private idleWaiters: Array<() => void> = [];

  /** One record per completed task, in completion order. */
  readonly history: RunRecord[] = [];

  enqueue(priority: number, task: Task): void {
    this.heap.push({ priority, seq: this.seq++, task, enqueuedAt: now() });
    // Reserve the run loop synchronously so a burst of enqueue() calls in the
    // same synchronous tick all land in the heap before draining starts -
    // otherwise the first enqueue would start popping immediately and run
    // its task before the second and third had a chance to out-rank it.
    if (!this.running) {
      this.running = true;
      queueMicrotask(() => void this.pump());
    }
  }

  get pending(): number {
    return this.heap.size;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Resolves once the queue is drained and no task is running. */
  onIdle(): Promise<void> {
    if (!this.running && this.heap.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async pump(): Promise<void> {
    let entry: Entry | undefined;
    while ((entry = this.heap.pop())) {
      const waitMs = now() - entry.enqueuedAt;
      const startedAt = now();
      let error: unknown = null;
      try {
        await entry.task();
      } catch (e) {
        error = e;
      }
      this.history.push({ priority: entry.priority, waitMs, runMs: now() - startedAt, error });
    }
    this.running = false;
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }
}
