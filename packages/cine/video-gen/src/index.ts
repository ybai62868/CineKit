/**
 * Video-generation Service Definition for one execution world. Backends own
 * submitting clips to an engine (a local ComfyUI+H3 stack or a hosted API),
 * polling async job status, and cancelling. Generation is always asynchronous:
 * a minutes-per-clip engine must never block the agent loop, so callers get a
 * {@link VideoGenJobId} and poll {@link getStatus} — typically from a
 * background job on `ctx.jobs`.
 * @module @deepseek-ai/dsh-video-gen
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  VideoGenJobId,
  VideoGenRequest,
  VideoJobStatus,
} from './types.ts'

export {
  VideoGenError,
  VideoGenJobId,
} from './types.ts'
export type {
  VideoGenErrorCode,
  VideoGenRequest,
  VideoGenResult,
  VideoJobStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    videoGen: VideoGenerator
  }
}

/**
 * Abstract video-generation provider. Submitting returns a job id immediately;
 * completion, failure, and progress surface through {@link getStatus}. The
 * seam is engine-agnostic: a local ComfyUI backend and a hosted API backend
 * implement the same contract, so the model-facing tool never changes when the
 * engine is swapped.
 */
export abstract class VideoGenerator extends Service {
  constructor(ctx: Context) {
    super(ctx, 'videoGen')
  }

  /**
   * Submit a generation request and return immediately with a job id.
   * @param request - the clip to generate (prompt, optional reference image, size).
   * @param signal - aborts the submit round-trip (not the submitted job; use
   *   {@link cancel} for that).
   * @returns the opaque job id to poll with {@link getStatus}.
   */
  abstract generate(request: VideoGenRequest, signal?: AbortSignal): Promise<VideoGenJobId>

  /**
   * Return the current lifecycle status of a job.
   * @param jobId - the id returned by {@link generate}.
   * @param signal - aborts the status round-trip.
   * @returns the current status; unknown ids report `failed` with
   *   `VIDEO_JOB_NOT_FOUND`.
   */
  abstract getStatus(jobId: VideoGenJobId, signal?: AbortSignal): Promise<VideoJobStatus>

  /**
   * Request cancellation of a running or queued job.
   * @param jobId - the id returned by {@link generate}.
   * @param signal - aborts the cancel round-trip.
   */
  abstract cancel(jobId: VideoGenJobId, signal?: AbortSignal): Promise<void>
}

export default VideoGenerator
