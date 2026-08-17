/**
 * Model-facing `video_generate` tool over `ctx.videoGen`. Submits a clip and
 * polls the job until it completes, fails, or exceeds the wait timeout, then
 * reports the produced video path. The package owns schemas and presentation,
 * never a concrete provider: it consumes the seam so the engine stays swappable.
 * @module @deepseek-ai/dsh-tool-video
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { VideoGenRequest, VideoJobStatus } from '@deepseek-ai/dsh-video-gen'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-video'

/** Services required by the video tool. */
export const inject = ['tools', 'videoGen']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** How long one tool call may wait for generation, in milliseconds. */
  waitTimeoutMs?: number
  /** Poll interval while waiting, in milliseconds. */
  pollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  waitTimeoutMs: z.number().default(15 * 60 * 1000),
  pollIntervalMs: z.number().default(3000),
})

type ResolvedConfig = Required<Config>

/** Sleep for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Map a terminal-but-not-completed status to a thrown, model-visible error. */
function terminalError(status: VideoJobStatus): Error {
  if (status.status === 'failed') {
    return new Error(`video generation failed: ${status.message}`)
  }
  return new Error('video generation was cancelled')
}

/**
 * Register the `video_generate` tool on `ctx.tools`. A call submits the clip,
 * waits for completion (up to the configured timeout), and returns the path.
 * @param ctx - registrant context carrying the tool registry and the seam.
 * @param config - deployment's wait policy.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const { waitTimeoutMs, pollIntervalMs } = resolved

  ctx.tools.register(defineTool({
    name: 'video_generate',
    description:
      'Generate one short video clip from a prompt (optionally anchored to a reference '
      + 'image for consistent appearance). Generation takes minutes, so this call waits '
      + 'for completion before returning. Prefer 480p and few steps for quick previews; '
      + 're-render only selected shots at higher resolution.',
    parameters: {
      prompt: {
        type: 'string',
        required: true,
        description: 'Natural-language shot description: subject, action, camera, lighting, style.',
      },
      referenceImage: {
        type: 'string',
        description: 'Optional local path or file: URI of a reference image to anchor the first frame (keeps a character consistent).',
      },
      negativePrompt: {
        type: 'string',
        description: 'What the shot should avoid.',
      },
      durationSeconds: {
        type: 'integer',
        description: 'Clip duration in seconds (default 5).',
      },
      width: {
        type: 'integer',
        description: 'Output width in pixels (default 832).',
      },
      height: {
        type: 'integer',
        description: 'Output height in pixels (default 480).',
      },
      steps: {
        type: 'integer',
        description: 'Sampling steps (default 8); more steps are finer but slower.',
      },
      seed: {
        type: 'integer',
        description: 'Deterministic seed for reproducibility.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          videoPath: { type: 'string', required: true },
          durationSeconds: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Generated video: ${value.videoPath} (${value.width}x${value.height}, ${value.durationSeconds}s).`,
      }],
    },
    async execute(args) {
      const request: VideoGenRequest = {
        prompt: args.prompt,
        ...(args.referenceImage !== undefined ? { referenceImage: args.referenceImage } : {}),
        ...(args.negativePrompt !== undefined ? { negativePrompt: args.negativePrompt } : {}),
        ...(args.durationSeconds !== undefined ? { durationSeconds: args.durationSeconds } : {}),
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(args.steps !== undefined ? { steps: args.steps } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
      }
      const jobId = await ctx.videoGen.generate(request)
      const deadline = Date.now() + waitTimeoutMs
      while (Date.now() < deadline) {
        const status = await ctx.videoGen.getStatus(jobId)
        if (status.status === 'completed') {
          const { result } = status
          return {
            videoPath: result.videoPath,
            durationSeconds: result.durationSeconds,
            width: result.width,
            height: result.height,
          }
        }
        if (status.status === 'failed' || status.status === 'cancelled') {
          throw terminalError(status)
        }
        await sleep(pollIntervalMs)
      }
      throw new Error(`video generation timed out after ${waitTimeoutMs}ms`)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate video',
      kind: 'other',
      rawInput: args.prompt,
    }),
  }))
}
