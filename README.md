# flow-cdp

Make Veo videos from a script with a Google AI subscription (Pro or Ultra) instead of a billed Gemini API key.
It drives [Google Flow](https://flow.google.com) in a Chrome you are already signed in to, over the Chrome
DevTools protocol, the same way you would click through it: upload the start frame, ask Flow's agent for the
clip, check the quoted cost, approve, wait, download.

```sh
node flow.mjs video \
  --first keyframe.png \
  --prompt "Close-up, the camera is locked. The robot glances at the clock and sighs. Audio: room tone, no music." \
  --out clip.mp4
```

It prints the project URL, the agent's plan and the quoted credits (to stdout), then `saved <path>`.

## Setup

- Node 22 or newer. No dependencies.
- Chrome started with `--remote-debugging-port=9222` and a profile signed in to a Google account whose plan
  includes Flow. Set `CDP_URL` if the port is elsewhere. Keep the port on localhost: anyone who reaches it
  controls the browser.
- In Flow's agent settings (the sliders icon by the prompt box), keep **Confirm before generating: Always**.
  The script reads every quote and refuses one that is over `--max-credits` or uses the wrong model.

## Options

| Flag | Default | |
|---|---|---|
| `--prompt` | (required) | The shot. Write it as a shot: framing, camera, one action, then the audio as its own sentence. |
| `--out` | (required) | Where the mp4 goes. |
| `--first` | none | Start frame. The clip begins on this exact image. |
| `--last` | none | End frame (frames to video). |
| `--model` | `Veo 3.1 - Fast` | Flow's label, or an API id such as `veo-3.1-generate-preview` (mapped to `Veo 3.1 - Quality`). |
| `--aspect` | `9:16` | `9:16` or `16:9`. |
| `--resolution` | `720p` | Download size: `720p`, `1080p`, `4K` (upscaled by Flow), `270p`. |
| `--max-credits` | `20` | Reject the agent's quote above this. |
| `--project` | new project | A Flow project URL to reuse. |
| `--account` | Chrome's first account | The Google account to use when the profile has several (e.g. `you@gmail.com`). |
| `--timeout` | `1500` | Seconds to wait for the clip. |

Environment: `CDP_URL`, `FLOW_ACCOUNT`, `FLOW_PROJECT`, `FLOW_DOWNLOADS` (where Chrome saves files, default
`~/Downloads`).

Exit codes: `0` saved, `1` the page did not look as expected, `2` usage, `3` quote rejected, `4` Flow failed or
refused the generation (worth one retry), `5` timed out (the clip may still finish in the project).

## What it learned about Flow (October 2026)

- Flow is agent-first: you ask in a chat, it answers with a plan and "costing N credits", and Approve /
  Always approve / Reject. Name the model and each image's role in the prompt, or it picks for you (it chose
  Veo 3.1 Lite once). One 8 s Veo 3.1 Fast clip cost 10 credits and took under 2 minutes.
- The chat can keep saying "waiting in the queue" after the clip is done. The script reloads the project every
  2 minutes and watches the media grid instead.
- A "Failed / Something went wrong" card can appear next to "it's waiting in the queue" with no clip ever
  coming. The script waits 3 minutes after it, then exits with code 4.
- "Upload media" opens a native file dialog. The script intercepts it with
  `Page.setInterceptFileChooserDialog` and hands the file over with `DOM.setFileInputFiles`.
- Uploads show a "Rights to use this image" notice; the script accepts it. Only upload what you have rights to.
- Approve is a plain element, not a button, so the script clicks it with real mouse events.

Flow's page changes without notice; when a step fails, the error says which one. Fixes are welcome.

## Tests

```sh
npm test
```

They cover the parts that do not need a browser: reading quotes and plans, model names, prompt wording.

## License

MIT. See LICENSE.
