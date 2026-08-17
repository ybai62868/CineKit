/**
 * Local MiniMax H3 backend for `ctx.videoGen`, driving a ComfyUI server over
 * its HTTP API. Submission posts a filled workflow to `/prompt`; status polls
 * `/history`; cancellation posts `/interrupt`. Generation is always async, so
 * `generate` returns the ComfyUI prompt id as a {@link VideoGenJobId} and the
 * tool layer polls {@link getStatus} — typically from a background job on
 * `ctx.jobs`.
 *
 * The backend is engine-agnostic about the workflow: it fills a caller-supplied
 * ComfyUI API-format template by string-replacing `__PLACEHOLDER__` tokens with
 * the request fields, then submits the result. The H3-specific node graph lives
 * in that template (exported from ComfyUI), not in code, so a model upgrade or
 * a different engine keeps this package unchanged.
 * @module @deepseek-ai/dsh-video-gen-local
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  VideoGenerator,
  VideoGenError,
  VideoGenJobId,
} from '@deepseek-ai/dsh-video-gen'
import type {
  VideoGenRequest,
  VideoGenResult,
  VideoJobStatus,
} from '@deepseek-ai/dsh-video-gen'

/** Configuration for the local ComfyUI backend. */
export interface Config {
  /** ComfyUI HTTP server base URL. */
  comfyuiUrl?: string
  /** Local directory where ComfyUI writes outputs (for resolving result paths). */
  outputDir?: string
  /**
   * The ComfyUI API-format workflow template. String tokens in node values are
   * replaced before submission: `__PROMPT__`, `__WIDTH__`, `__HEIGHT__`,
   * `__STEPS__`, `__LENGTH__`, `__SEED__`, `__OUTPUT_PREFIX__`.
   */
  workflowTemplate: unknown
  /** Default output width in pixels (overridden by the request). */
  width?: number
  /** Default output height in pixels (overridden by the request). */
  height?: number
  /** Default sampling steps (overridden by the request). */
  steps?: number
  /** Default clip duration in seconds (overridden by the request). */
  durationSeconds?: number
  /** SaveVideo filename prefix (the subfolder/file basename). */
  outputPrefix?: string
  /** Poll interval for status, in milliseconds. */
  pollIntervalMs?: number
  /** Hard timeout for one generation, in milliseconds. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  comfyuiUrl: z.string().default('http://127.0.0.1:8188'),
  outputDir: z.string().default('output'),
  workflowTemplate: z.any(),
  width: z.number().default(832),
  height: z.number().default(480),
  steps: z.number().default(8),
  durationSeconds: z.number().default(5),
  outputPrefix: z.string().default('cinekit/video'),
  pollIntervalMs: z.number().default(2000),
  timeoutMs: z.number().default(30 * 60 * 1000),
})

type ResolvedConfig = Required<Config>

/** ComfyUI history entry shape (the fields this backend reads). */
interface ComfyUiHistoryEntry {
  status?: {
    status_str?: string
    completed?: boolean
  }
  outputs?: Record<string, {
    images?: Array<{ filename: string; subfolder?: string; type?: string }>
    gifs?: Array<{ filename: string; subfolder?: string; type?: string }>
  }>
}

/** H3 runs at 24 fps; its latent frame count snaps to the 17k+5 grid. */
const H3_FPS = 24
const H3_GRID_STEP = 17
const H3_GRID_REMAINDER = 5

/** Snap a clip duration (seconds) onto H3's 17k+5 frame grid, ≥ 5 frames. */
function alignFrameCount(durationSeconds: number): number {
  let frames = Math.round(durationSeconds * H3_FPS)
  if (frames < H3_GRID_REMAINDER) frames = H3_GRID_REMAINDER
  while (frames % H3_GRID_STEP !== H3_GRID_REMAINDER) frames += 1
  return frames
}

/** Video filename suffixes the backend recognizes as finished artifacts. */
const VIDEO_SUFFIXES = ['.mp4', '.webm', '.mov', '.gif', '.avi']

function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return VIDEO_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

function resolveVideoPath(outputDir: string, filename: string, subfolder?: string): string {
  return subfolder ? `${outputDir}/${subfolder}/${filename}` : `${outputDir}/${filename}`
}

/** Error raised when the ComfyUI server cannot be reached. */
function engineUnavailable(cause: unknown): VideoGenError {
  return new VideoGenError(
    `ComfyUI unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    'VIDEO_ENGINE_UNAVAILABLE',
    { cause },
  )
}

/**
 * The local ComfyUI backend. Submits filled workflow templates, polls history,
 * and maps the ComfyUI lifecycle onto the {@link VideoJobStatus} union.
 */
export class LocalVideoGenerator extends VideoGenerator {
  static Config: z<Config> = Config

  /** Validated config (schemastery applied the defaults before construction). */
  readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config as ResolvedConfig
  }

  override async generate(request: VideoGenRequest, signal?: AbortSignal): Promise<VideoGenJobId> {
    const workflow = this.buildWorkflow(request)
    try {
      const response = await fetch(`${this.config.comfyuiUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
        signal: signal ?? null,
      })
      if (!response.ok) {
        throw new VideoGenError(
          `ComfyUI rejected the prompt: HTTP ${response.status}`,
          'VIDEO_GENERATION_FAILED',
        )
      }
      const body = await response.json() as { prompt_id?: string }
      if (typeof body.prompt_id !== 'string' || body.prompt_id === '') {
        throw new VideoGenError('ComfyUI returned no prompt_id', 'VIDEO_GENERATION_FAILED')
      }
      return VideoGenJobId(body.prompt_id)
    } catch (error) {
      if (error instanceof VideoGenError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new VideoGenError('submit aborted', 'VIDEO_ABORTED', { cause: error })
      }
      throw engineUnavailable(error)
    }
  }

  override async getStatus(jobId: VideoGenJobId, signal?: AbortSignal): Promise<VideoJobStatus> {
    const history = await this.fetchHistory(jobId, signal)
    const entry = history[jobId]
    if (entry === undefined) {
      // Not in history yet: either still queued/running, or the id is unknown.
      return this.pollQueue(jobId, signal)
    }
    if (entry.status?.completed === true) {
      return this.completedStatus(entry)
    }
    return this.runningStatus()
  }

  override async cancel(_jobId: VideoGenJobId, signal?: AbortSignal): Promise<void> {
    // ComfyUI's /interrupt stops the currently-executing prompt only; there is
    // no per-job cancellation endpoint, so the job id cannot narrow this call.
    try {
      const response = await fetch(`${this.config.comfyuiUrl}/interrupt`, {
        method: 'POST',
        signal: signal ?? null,
      })
      if (!response.ok) {
        throw new VideoGenError(
          `ComfyUI rejected the interrupt: HTTP ${response.status}`,
          'VIDEO_GENERATION_FAILED',
        )
      }
    } catch (error) {
      if (error instanceof VideoGenError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new VideoGenError('cancel aborted', 'VIDEO_ABORTED', { cause: error })
      }
      throw engineUnavailable(error)
    }
  }

  /** Fill the workflow template with the request fields and parse it back. */
  private buildWorkflow(request: VideoGenRequest): Record<string, unknown> {
    const seed = request.seed ?? Math.floor(Math.random() * 0xffffffff)
    const length = alignFrameCount(request.durationSeconds ?? this.config.durationSeconds)
    const filled = JSON.stringify(this.config.workflowTemplate)
      .replaceAll('__PROMPT__', request.prompt)
      .replaceAll('__WIDTH__', String(request.width ?? this.config.width))
      .replaceAll('__HEIGHT__', String(request.height ?? this.config.height))
      .replaceAll('__STEPS__', String(request.steps ?? this.config.steps))
      .replaceAll('__LENGTH__', String(length))
      .replaceAll('__SEED__', String(seed))
      .replaceAll('__OUTPUT_PREFIX__', this.config.outputPrefix)
    return JSON.parse(filled) as Record<string, unknown>
  }

  private async fetchHistory(jobId: VideoGenJobId, signal?: AbortSignal): Promise<Record<string, ComfyUiHistoryEntry>> {
    try {
      const response = await fetch(`${this.config.comfyuiUrl}/history/${jobId}`, { signal: signal ?? null })
      if (!response.ok) {
        throw new VideoGenError(
          `ComfyUI history failed: HTTP ${response.status}`,
          'VIDEO_GENERATION_FAILED',
        )
      }
      return await response.json() as Record<string, ComfyUiHistoryEntry>
    } catch (error) {
      if (error instanceof VideoGenError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new VideoGenError('status aborted', 'VIDEO_ABORTED', { cause: error })
      }
      throw engineUnavailable(error)
    }
  }

  /** Check `/queue` to distinguish still-queued from unknown ids. */
  private async pollQueue(jobId: VideoGenJobId, signal?: AbortSignal): Promise<VideoJobStatus> {
    try {
      const response = await fetch(`${this.config.comfyuiUrl}/queue`, { signal: signal ?? null })
      if (!response.ok) {
        throw new VideoGenError(
          `ComfyUI queue failed: HTTP ${response.status}`,
          'VIDEO_GENERATION_FAILED',
        )
      }
      const queue = await response.json() as {
        queue_running?: unknown[]
        queue_pending?: unknown[]
      }
      const running = (queue.queue_running ?? []).some((item) => {
        const tuple = item as [number, string, unknown]
        return tuple[1] === String(jobId)
      })
      const pending = (queue.queue_pending ?? []).some((item) => {
        const tuple = item as [number, string, unknown]
        return tuple[1] === String(jobId)
      })
      if (running || pending) return { status: 'running', progress: 0 }
      return {
        status: 'failed',
        code: 'VIDEO_JOB_NOT_FOUND',
        message: `no ComfyUI job matches ${jobId}`,
      }
    } catch (error) {
      if (error instanceof VideoGenError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new VideoGenError('status aborted', 'VIDEO_ABORTED', { cause: error })
      }
      throw engineUnavailable(error)
    }
  }

  /** Map a completed history entry to a result, or to a failure when no video. */
  private completedStatus(entry: ComfyUiHistoryEntry): VideoJobStatus {
    const video = this.findVideo(entry)
    if (video === undefined) {
      return {
        status: 'failed',
        code: 'VIDEO_GENERATION_FAILED',
        message: 'ComfyUI completed but produced no video artifact',
      }
    }
    const result: VideoGenResult = {
      videoPath: resolveVideoPath(this.config.outputDir, video.filename, video.subfolder),
      durationSeconds: this.config.durationSeconds,
      width: this.config.width,
      height: this.config.height,
    }
    return { status: 'completed', result }
  }

  /** Derive a running status. Progress is always 0 until completion. */
  private runningStatus(): VideoJobStatus {
    return { status: 'running', progress: 0 }
  }

  private findVideo(entry: ComfyUiHistoryEntry): { filename: string; subfolder?: string } | undefined {
    for (const node of Object.values(entry.outputs ?? {})) {
      for (const candidate of [...(node.images ?? []), ...(node.gifs ?? [])]) {
        if (isVideoFile(candidate.filename)) {
          return {
            filename: candidate.filename,
            ...(candidate.subfolder !== undefined ? { subfolder: candidate.subfolder } : {}),
          }
        }
      }
    }
    return undefined
  }
}

export default LocalVideoGenerator
