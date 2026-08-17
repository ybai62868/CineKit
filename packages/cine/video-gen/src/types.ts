/**
 * Vocabulary for the video-generation Service Definition (`ctx.videoGen`):
 * the branded job id, the text/image-to-video request, the async job-status
 * union, and the typed error taxonomy.
 * @module @deepseek-ai/dsh-video-gen/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Opaque identifier for one submitted generation job. A local backend may key
 * it to a ComfyUI prompt id; a remote backend to a provider task id. Consumers
 * MUST NOT parse it or assume it is a local path.
 */
export type VideoGenJobId = Branded<'VideoGenJobId'>

/**
 * Brand a string as a {@link VideoGenJobId}. For backend use only — a consumer
 * never manufactures an id, it receives one from `generate()`.
 * @param id - the backend's raw job id string.
 * @returns the same string, branded; no validation is performed.
 */
export function VideoGenJobId(id: string): VideoGenJobId {
  return id as VideoGenJobId
}

/**
 * A request to generate one video clip. `referenceImage` switches the engine
 * into image-to-video mode (the first frame is anchored to that image), which
 * is the appearance-anchor hook the character-consistency capability feeds.
 */
export interface VideoGenRequest {
  /** Natural-language prompt describing the shot. */
  prompt: string
  /**
   * Optional reference image (a local absolute path or `file:` URI). When
   * present the engine anchors the first frame to it, keeping the subject's
   * appearance stable across shots.
   */
  referenceImage?: string
  /** Clip duration in seconds. Defaults to the backend default (5s). */
  durationSeconds?: number
  /** Output width in pixels. Must align to the engine's stride (typically 32). */
  width?: number
  /** Output height in pixels. Must align to the engine's stride (typically 32). */
  height?: number
  /** Sampling steps; fewer steps are faster but coarser. */
  steps?: number
  /** Deterministic seed, when the backend supports reproducibility. */
  seed?: number
  /** Negative prompt steering what the model should avoid. */
  negativePrompt?: string
}

/** A completed generation's artifact and metadata. */
export interface VideoGenResult {
  /** Local absolute path (or `file:` URI) of the produced video. */
  videoPath: string
  /** Actual clip duration in seconds. */
  durationSeconds: number
  /** Actual output width in pixels. */
  width: number
  /** Actual output height in pixels. */
  height: number
  /** The seed actually used, when known. */
  seed?: number
}

/**
 * The lifecycle status of a submitted job. A closed union: switch on `status`
 * and exhaust with `assertNever` at the consumer boundary.
 */
export type VideoJobStatus =
  | { readonly status: 'queued' }
  | { readonly status: 'running'; readonly progress: number }
  | { readonly status: 'completed'; readonly result: VideoGenResult }
  | { readonly status: 'failed'; readonly code: VideoGenErrorCode; readonly message: string }
  | { readonly status: 'cancelled' }

/** Stable, machine-routable codes for video-generation failures. */
export type VideoGenErrorCode =
  | 'VIDEO_ENGINE_UNAVAILABLE'
  | 'VIDEO_REQUEST_INVALID'
  | 'VIDEO_JOB_NOT_FOUND'
  | 'VIDEO_GENERATION_FAILED'
  | 'VIDEO_TIMEOUT'
  | 'VIDEO_ABORTED'

/**
 * Typed video-generation error. Extends {@link HarnessError} so it carries a
 * stable {@link VideoGenErrorCode} and chains `cause`; backends and the tool
 * layer raise the same codes instead of each inventing message strings.
 */
export class VideoGenError extends HarnessError {
  override readonly code: VideoGenErrorCode

  constructor(message: string, code: VideoGenErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}
