# CineKit

A **local-first, composable AI filmmaking framework** for game cinematics and short-form video.
CineKit is a fork of [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (MIT),
retuned for AI video production, combined with the node-graph workflow paradigm of
[ComfyUI](https://github.com/comfyanonymous/ComfyUI).

## What it is

CineKit is a plugin-based agent harness tuned for AI video production. It pairs a
cloud reasoning brain with a **local** video-generation engine, and wraps the whole
pipeline — script → storyboard → shot → render → edit — in composable, replaceable
capabilities.

```
┌─────────────────────────────────────────────────────────────┐
│  Brain   DeepSeek API (deepseek-chat / deepseek-reasoner)    │  ← cloud, reasoning + tool-calling
│  Engine  MiniMax H3 (local, via ComfyUI)                     │  ← local, video generation
│  Skeleton CineKit (capability seams + agent loop)        │  ← this repo
└─────────────────────────────────────────────────────────────┘
```

## Relationship to deepseek-harness

CineKit is a full fork of deepseek-harness: the entire `@deepseek-ai/dsh-*` package
tree (capability seams, session log, tool pipeline, sandbox, agent loop) ships here
unchanged, so every upstream capability is available out of the box. CineKit adds its
own packages under `packages/cine/` (video generation, character consistency, ComfyUI
execution, project timeline) and keeps the upstream scope (`@deepseek-ai/dsh-*`) for
now; rescoping to `@cinekit/*` is deferred until the M0 loop works.

Upstream fork point: `deepseek-ai/deepseek-harness@47f943859b`.

## Why CineKit

AI comic-drama and short-video tools are everywhere, but they share the same pain:
creators juggle five or six tools (script → image → video → voice → edit) and are locked
into each platform's closed pipeline. CineKit inverts this:

- **Open, composable workflows** — ComfyUI-style node graphs that humans edit visually
  and agents execute automatically (the LibTV "workflow = skill" pattern), with results
  interchangeable between the two modes.
- **Character consistency as a first-class capability** — the single hardest problem in
  AI video, designed as a swappable seam rather than an afterthought.
- **Local video generation** — MiniMax H3 runs on a 16 GB consumer GPU, so the engine is
  yours, not a rented API.

## Architecture

Every capability is a **seam** with three roles: a *Service Definition* (the contract),
a *Provider* (the implementation), and a *Consumer* (usually a model-facing tool).

| ctx service | Role | Definition | Provider | Consumer |
|---|---|---|---|---|
| `ctx.llm` | brain | (from dsh) | `llm-deepseek` | agent-loop |
| `ctx.videoGen` | video | text2video / image2video / status / cancel | `minimax-h3-local` (ComfyUI), `minimax-h3-api` (later) | `tool-video` |
| `ctx.character` | consistency | register / getSheet / buildAnchor / check | `character-local` | `tool-video`, `tool-character` |
| `ctx.comfyui` | workflow exec | runWorkflow / getNodeDefs / getProgress | `comfyui-local` | `tool-comfyui` |
| `ctx.project` | timeline | createProject / addShot / addClip | `project-local` | `tool-project` |
| `ctx.jobs` | background | (from dsh) | `jobs-local` | `tool-jobs` |
| `ctx.subagents` | delegation | (from dsh) | `subagent-in-process` | `tool-subagent` |

The killer seam is **`ctx.character`** — character consistency enforced in four layers:

1. **Profile** — a three-view character sheet + canonical appearance prompt + branded id.
2. **Anchor** — the sheet is fed as the image2video first frame, and appearance keywords
   are force-injected into every shot prompt.
3. **Check** — post-generation CLIP similarity against the sheet; below threshold, retry.
4. **State** — versioned appearance (injured / costume change / multi-season reuse).

## Roadmap

- **M0 — closed loop**: one prompt → one shot. DeepSeek adapter + `ctx.videoGen` +
  `minimax-h3-local` + `tool-video`, video stored via `ctx.assets`.
- **M1 — the moat**: `ctx.character` + single-hero 3-shot consistency demo.
- **M2 — the showpiece**: four-hero "assembly" short + `ctx.project` timeline + ComfyUI post.

## Hardware

Local H3 inference is validated on a **16 GB VRAM GPU + ≥64 GB RAM** (see the
[consumer-GPU deployment handbook](https://github.com/neng320/minimax-h3-local-deployment)).
Generation is minutes-per-shot, so the pipeline previews at 480p and re-renders only
selected shots at 768p.

### Reference build

The author develops CineKit on the following machine — a known-good "recommended tier"
for local H3. The 16 GB VRAM card runs the pruned-INT8 DiT comfortably, and the large
system RAM leaves headroom for the full-INT8 model.

| Component | Spec |
|---|---|
| CPU | AMD Ryzen 9 9950X (16-core) |
| GPU | NVIDIA GeForce RTX 5080, 16 GB VRAM |
| RAM | 93.6 GB |
| Driver | NVIDIA 610.88 |
| OS | Windows 11 |
| Inference stack | ComfyUI v0.30.0+ · PyTorch cu130 · SageAttention |

Estimated generation on this build (extrapolated from the 4060 Ti baseline in the
handbook above):

| Resolution | Duration | Est. time |
|---|---|---|
| 480p · 5s | 832×480 | ~1.5–2 min/shot |
| 768p · 5s | 1344×768 | ~8–12 min/shot |

## Status

Pre-release. No tagged release yet; architecture is free to change.
