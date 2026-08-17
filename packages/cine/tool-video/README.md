# `@deepseek-ai/dsh-tool-video`

The model-facing `video_generate` tool over `ctx.videoGen`. A call submits a
clip and polls the job until it completes, fails, or exceeds the wait timeout,
then reports the produced video path.

This package owns schemas and presentation, never a concrete provider — it
consumes the seam, so swapping the local ComfyUI backend for a hosted API
backend never touches the tool.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `waitTimeoutMs` | `900000` (15 min) | How long one call waits for generation |
| `pollIntervalMs` | `3000` | Poll interval while waiting |

## Known Limitations and Deferred Work

- The tool blocks the turn while waiting (minutes-per-shot). M1 moves the wait
  onto `ctx.jobs` so the agent can keep working or poll a background job.
- There is no progress surface in the output; only the completed path is
  reported.
