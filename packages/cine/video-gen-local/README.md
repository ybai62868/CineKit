# `@deepseek-ai/dsh-video-gen-local`

The local MiniMax H3 backend for `ctx.videoGen`, driving a ComfyUI server over
its HTTP API. It submits a filled workflow to `/prompt`, polls `/history` for
status, and posts `/interrupt` to cancel.

The backend is engine-agnostic about the workflow: it fills a caller-supplied
ComfyUI API-format template by string-replacing `__PLACEHOLDER__` tokens with
the request fields. The H3-specific node graph lives in that template (exported
from ComfyUI's `Video → MiniMax H3` template), not in code.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `comfyuiUrl` | `http://127.0.0.1:8188` | ComfyUI server base URL |
| `outputDir` | `output` | Directory ComfyUI writes video artifacts to |
| `workflowTemplate` | (required) | API-format workflow JSON with `__PLACEHOLDER__` tokens |
| `width` / `height` | `832` / `480` | Default output size |
| `steps` | `8` | Default sampling steps |
| `durationSeconds` | `5` | Default clip duration |
| `pollIntervalMs` | `2000` | Status poll interval |
| `timeoutMs` | `1800000` | Hard timeout per generation |

Supported template tokens: `__PROMPT__`, `__WIDTH__`, `__HEIGHT__`,
`__STEPS__`, `__LENGTH__`, `__SEED__`, `__OUTPUT_PREFIX__`.

`__LENGTH__` is the H3 latent frame count, derived from the request duration by
`alignFrameCount()` — snapped onto H3's `17k+5` frame grid at 24 fps (5 s → 124).
A ready-to-use text-to-video template ships in `workflows/h3-t2v-template.json`
(validated against ComfyUI 0.30.1 + the pruned-INT8 DiT on a 16 GB GPU).

## Known Limitations and Deferred Work

- Progress is always `0` until completion: ComfyUI's history payload does not
  expose a scalar progress for the video node without polling node-by-node.
  Per-stage progress is deferred.
- The result's `durationSeconds`/`width`/`height` echo the request defaults, not
  the engine's actual output; re-deriving them from the artifact is deferred.
- `__REFERENCE_IMAGE__` substitution is a bare string; wiring it into a ComfyUI
  `LoadImage` node id is the template author's responsibility.
