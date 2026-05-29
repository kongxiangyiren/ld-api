## HTTP API Reference

Once you have selected a model in Local Dream, the embedded C++ backend exposes an HTTP API on `127.0.0.1:8081`. You can use it to drive Local Dream from scripts on the same device (Termux) or from your computer (via `adb forward`).

The original announcement of this API lives at [xororz/local-dream#45](https://github.com/xororz/local-dream/issues/45). This page documents the current set of parameters as implemented in the backend's [main.cpp](https://github.com/xororz/local-dream/blob/master/app/src/main/cpp/src/main.cpp).

## Prerequisites

1. Open Local Dream and select a model. The backend only starts listening after a model has been loaded — there is no way to start it without going through the model loading flow first.

2. The server binds to 127.0.0.1 only, so it is not reachable from other devices on the network without explicit forwarding.

## Connecting

**From a desktop via ADB**

```bash
adb forward tcp:8081 tcp:8081
# Now http://localhost:8081 on the desktop reaches the backend.
```

**On-device via Termux**

Run your script directly inside Termux on the same phone — `localhost:8081` will reach the backend.

## Endpoints

| Method | Path        | Purpose                                              |
| ------ | ----------- | ---------------------------------------------------- |
| POST   | `/generate` | Run a generation; streamed via Server-Sent Events    |
| POST   | `/tokenize` | Count prompt tokens against the model's 77-token cap |

## POST `/generate`

The main endpoint. Accepts a JSON body and streams progress + the final image as Server-Sent Events (`Content-Type: text/event-stream`).

### Request fields [​](#request-fields)

| Field                    | Type   | Default      | Notes                                                                                                                                                                                                                                              |
| ------------------------ | ------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`                 | string | **required** | Positive prompt.                                                                                                                                                                                                                                   |
| `negative_prompt`        | string | `""`         | Negative prompt.                                                                                                                                                                                                                                   |
| `steps`                  | int    | `20`         | Number of sampler steps.                                                                                                                                                                                                                           |
| `cfg`                    | float  | `7.5`        | CFG scale. On NPU, `cfg == 1.0` triggers the unconditional-pass skip optimization.                                                                                                                                                                 |
| `seed`                   | uint   | random       | Set for reproducible output.                                                                                                                                                                                                                       |
| `scheduler`              | string | `"dpm"`      | See [Scheduler values](#scheduler-values) below. Unknown values fall back to `"dpm"`.                                                                                                                                                              |
| `size`                   | int    | `512`        | Shortcut for a square output. If present, overrides `width` / `height`.                                                                                                                                                                            |
| `width`, `height`        | int    | `512`        | Used only when `size` is not given.                                                                                                                                                                                                                |
| `use_opencl`             | bool   | `false`      | CPU mode only — see below.                                                                                                                                                                                                                         |
| `show_diffusion_process` | bool   | `false`      | When true, each `progress` event also carries an intermediate image preview (where supported).                                                                                                                                                     |
| `show_diffusion_stride`  | int    | `1`          | Emit a preview every N steps. Only meaningful when `show_diffusion_process` is true.                                                                                                                                                               |
| `image`                  | string | _(omit)_     | Base64-encoded **PNG/JPG bytes** of a source image. Presence of this field switches the run into img2img.                                                                                                                                          |
| `mask`                   | string | _(omit)_     | Base64-encoded PNG/JPG mask bytes. Requires `image` to also be present; switches the run into inpaint.                                                                                                                                             |
| `denoise_strength`       | float  | `0.6`        | img2img / inpaint denoise strength.                                                                                                                                                                                                                |
| `aspect_ratio`           | string | `"1:1"`      | SDXL NPU only. Two positive integers `W:H` (e.g. `"3:4"`, `"16:9"`). Long side is 1024, short side scaled and rounded up to a multiple of 8. Ignored in other modes. See [SDXL Aspect Ratio](https://ld-guide.chino.icu/models/sdxl-aspect-ratio). |

The `image` and `mask` payloads must be **encoded** images (PNG or JPG), not raw RGB. They are decoded by the backend and resized to the requested output dimensions internally.

### Scheduler values

The `scheduler` field accepts the following strings:

| Value                | Matches UI              | Notes                                                                                 |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `dpm`                | `DPM++ 2M`              | Default fallback for unknown values.                                                  |
| `dpm_karras`         | `DPM++ 2M` + Karras     | Karras sigma schedule.                                                                |
| `dpm_sde`            | `DPM++ 2M SDE`          | Stochastic DPM++ variant.                                                             |
| `dpm_sde_karras`     | `DPM++ 2M SDE` + Karras |                                                                                       |
| `euler_a` / `eulera` | `Euler A`               | Ancestral Euler. Both spellings accepted.                                             |
| `euler_a_karras`     | `Euler A` + Karras      |                                                                                       |
| `euler`              | `Euler`                 | Deterministic Euler.                                                                  |
| `euler_karras`       | `Euler` + Karras        |                                                                                       |
| `lcm`                | `LCM`                   | Low-step fast generation. Karras is **not** supported — do not append `_karras` here. |

To enable the Karras noise schedule, append `_karras` to the scheduler name (except for `lcm`). The Karras toggle in the UI maps to this suffix.

### Mode-specific behavior

#### SD1.5 — CPU mode

- size / width / height can be anything, but must be multiples of 8. Width and height can differ.
- use_opencl: true swaps the MNN compute backend to OpenCL on the GPU. The first run at each resolution generates a cache and is slow; subsequent runs at the same resolution are much faster.
- All schedulers listed above are supported, including their \_karras variants.

#### SD1.5 — NPU mode

- size (or width × height) must match the resolution you selected when entering the model. A mismatch produces a runtime error rather than auto-resizing.
- use_opencl is accepted but ignored.
- All schedulers listed above are supported, including their \_karras variants.
- When cfg == 1.0, the unconditional UNet pass is skipped, roughly halving per-step time.

#### SDXL — NPU mode

- The compute graph always runs at 1024 × 1024 internally. size / width / height are ignored — the output dimensions come from aspect_ratio.
- Default aspect_ratio is "1:1" (1024 × 1024). Set e.g. "3:4" or "16:9" to get non-square output; the long side stays at 1024 and the short side is rounded up to a multiple of 8. See SDXL Aspect Ratio for how this works.
- Other fields behave the same as in SD1.5 NPU mode.

### Streamed response

The endpoint responds with `text/event-stream`. Each event is one of:

```
event: progress
data: {"type":"progress","step":3,"total_steps":20,"image":"<base64>"}
```

The `image` field on a `progress` event is only present when `show_diffusion_process` is enabled and the runtime supports producing previews at that stride.

```
event: complete
data: {"type":"complete","image":"<base64>","seed":...,"width":...,"height":...,"channels":3,"generation_time_ms":...,"first_step_time_ms":...}
```

> **Important:** the `image` field on `complete` is **base64-encoded raw RGB pixel bytes** (`channels = 3`), not a PNG or JPG. Clients must reshape it as `(height, width, channels)` to obtain an image.

```
event: error
data: {"type":"error","message":"..."}
```

For client-side errors (invalid JSON, missing `prompt`, decode failures, etc.) the server may instead return a non-streaming JSON body with HTTP 400 / 500.

## POST `/tokenize`

Counts tokens for a prompt against the model's 77-token CLIP cap.

Request:

```
{ "prompt": "1girl, masterpiece, ..." }
```

Response:

```
{ "count": 12, "max_length": 77 }
```

Embeddings expand into multiple tokens, and that is reflected in `count`. The constant `+2` for BOS / EOS is already included.

## Example client [​](#example-client)

A reference Python client that handles the SSE stream and decodes the raw-RGB result image is in [xororz/local-dream#45](https://github.com/xororz/local-dream/issues/45).
