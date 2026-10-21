import { describe, expect, it } from 'vitest';
import { PriorityScheduler } from '../src/background/scheduler';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('PriorityScheduler', () => {
  it('runs tasks in priority order regardless of enqueue order', async () => {
    const scheduler = new PriorityScheduler();
    const order: string[] = [];
    // Enqueue low priority first so a naive FIFO queue would run it first.
    scheduler.enqueue(5, () => { order.push('low'); });
    scheduler.enqueue(0, () => { order.push('high'); });
    scheduler.enqueue(2, () => { order.push('mid'); });
    await scheduler.onIdle();
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('preserves enqueue order for equal-priority tasks (stable FIFO)', async () => {
    const scheduler = new PriorityScheduler();
    const order: number[] = [];
    for (let i = 0; i < 5; i++) {
      scheduler.enqueue(1, () => { order.push(i); });
    }
    await scheduler.onIdle();
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs two tasks concurrently', async () => {
    const scheduler = new PriorityScheduler();
    let inFlight = 0;
    let maxInFlight = 0;
    const body = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight--;
    };
    for (let i = 0; i < 8; i++) scheduler.enqueue(i % 3, body);
    await scheduler.onIdle();
    expect(maxInFlight).toBe(1);
  });

  it('keeps draining after a task throws, and records the error', async () => {
    const scheduler = new PriorityScheduler();
    const ran: string[] = [];
    scheduler.enqueue(0, () => { throw new Error('boom'); });
    scheduler.enqueue(1, () => { ran.push('after'); });
    await scheduler.onIdle();
    expect(ran).toEqual(['after']);
    expect(scheduler.history).toHaveLength(2);
    expect(scheduler.history[0].error).toBeInstanceOf(Error);
    expect(scheduler.history[1].error).toBeNull();
  });

  it('waits for tasks enqueued while the loop is already running', async () => {
    const scheduler = new PriorityScheduler();
    const order: string[] = [];
    scheduler.enqueue(0, async () => {
      order.push('first');
      await delay(5);
      // Enqueue a second task mid-run; onIdle below must still wait for it.
      scheduler.enqueue(0, () => { order.push('second'); });
    });
    await scheduler.onIdle();
    expect(order).toEqual(['first', 'second']);
    expect(scheduler.pending).toBe(0);
    expect(scheduler.isRunning).toBe(false);
  });

  it('records non-negative wait and run times for every task', async () => {
    const scheduler = new PriorityScheduler();
    scheduler.enqueue(0, () => delay(2));
    scheduler.enqueue(0, () => {});
    await scheduler.onIdle();
    for (const record of scheduler.history) {
      expect(record.waitMs).toBeGreaterThanOrEqual(0);
      expect(record.runMs).toBeGreaterThanOrEqual(0);
    }
  });
});
