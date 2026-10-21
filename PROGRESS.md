# Progress log

One line per shipped iteration: date, what shipped, the measured number.

- 2026-07-22: added `src/background/scheduler.ts`, a from-scratch priority task scheduler (binary min-heap + drain loop) for the command pipeline, benchmarked against a plain FIFO queue under mixed command/background load: priority-aware command wait p50 2.7ms / p99 20.2ms vs FIFO p50 620.0ms / p99 1245.5ms on the same workload (`npm run eval:scheduler`).
- 2026-07-23: reran the scheduler benchmark over 5 trials with mean +/- stddev instead of one sample, and stated its scope plainly (scheduling policy under a constructed backlog, not general throughput): priority-aware command wait p50 2.922ms +/- 0.215ms / p99 5.986ms +/- 1.917ms vs FIFO p50 632.227ms +/- 3.356ms / p99 1255.193ms +/- 8.098ms.
- 2026-07-23: added `src/shared/vision-frame-codec.ts`, a from-scratch binary wire codec for the per-camera-frame gaze/hand message, with round-trip tests and a benchmark against JSON: 6.5 bytes vs 70.0 bytes average payload (10.8x smaller); round-trip latency p50 0.0058ms vs JSON's 0.0077ms, p99 0.0290ms vs JSON's 0.0212ms (`npm run eval:wire-codec`).
