# `@deepseek-ai/dsh-video-gen`

The video-generation Service Definition (`ctx.videoGen`) for CineKit: the async
text/image-to-video submission contract, the job-status vocabulary, and the
typed error taxonomy.

Generation is always asynchronous — a minutes-per-clip engine must not block
the agent loop — so `generate()` returns a branded `VideoGenJobId` immediately
and callers poll `getStatus()`. This package owns only the seam; backends
(`@deepseek-ai/dsh-video-gen-local` for the local ComfyUI+H3 stack) implement it,
and the model-facing `tool-video` consumes it.

## API

- `generate(request)` — submit a clip (prompt + optional reference image for
  image-to-video) and get a `VideoGenJobId`.
- `getStatus(jobId)` — poll lifecycle: `queued → running → completed | failed | cancelled`.
- `cancel(jobId)` — request cancellation of a running or queued job.

`referenceImage` on the request is the appearance-anchor hook: when present the
engine anchors the first frame to it, which is how character consistency keeps a
subject stable across shots.

## Extension points

Register a backend by subclassing `VideoGenerator` and mounting it (the
constructor registers `ctx.videoGen`). A hosted API backend and the local
ComfyUI backend implement the same contract, so swapping the engine never
touches the tool layer.

## Known Limitations and Deferred Work

- M0 ships the abstract seam only; the local ComfyUI+H3 backend is
  `@deepseek-ai/dsh-video-gen-local`, and no hosted backend exists yet.
- Progress is reported as a scalar `0..1`; richer per-stage detail (latent →
  decode → VAE) is deferred.
- No `video-gen/*` event vocabulary yet; adding live status events is deferred
  until the model-visible logging contract is settled.
