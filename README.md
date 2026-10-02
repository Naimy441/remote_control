A phone trackpad for a Mac on your Tailscale network.

The page is a Next.js app. The thing that actually moves the pointer is a small agent that has to run on the Mac, because a website cannot inject mouse or keyboard events by itself. Your phone opens the page over Tailscale and sends gestures straight to that agent.

This is meant for your own tailnet. Do not port-forward it, and do not put it on Tailscale Funnel. Anyone with the token can drive the Mac.

## Requirements

- A Mac with the Xcode command line tools (`swiftc` compiles the input helper, the app list, and the menu bar control)
- Node.js 20 or newer
- Tailscale on the Mac and on the phone, signed into the same tailnet
- Accessibility permission for `RemoteInput` (asked for on first launch)

## Run it

On the Mac:

```bash
npm install
npm run mac
```

The terminal prints a link and a token. On the phone, turn Tailscale on and open that link (the `https://` one if it is listed; see [HTTPS over Tailscale](#https-over-tailscale)). The token in the link signs you in once and is then stored on the phone.

The first run creates `agent/.token` (mode `600`). That file, the printed links in `agent/link.txt`, and the compiled helpers in `agent/bin/` stay on the machine. They are listed in `.gitignore`. To issue a new token, stop the agent, delete `agent/.token`, and start again. You can also set `AGENT_TOKEN` in the environment instead of using the file.

`RC` appears in the Mac menu bar, next to Wi-Fi and Control Center. Use it to start or stop, or to copy the phone link. Stopping from the menu quits this command. `RC` stays, so you can start again without opening Terminal. Remove from menu bar hides it; the next `npm run mac` puts it back.

The first launch asks for Accessibility permission for `RemoteInput`. Allow it in System Settings → Privacy & Security → Accessibility. If the pointer still does not move, quit `npm run mac` and start it again. Recompiling `RemoteInput` can make macOS forget that permission, so allow it again if the pointer stops after an update.

Firefox, Chrome, and Safari tab switching may also ask for Automation permission under Privacy & Security → Automation.

## Gestures

The pad tracks at most two fingers, each shown as a glowing ring.

- One finger drag moves the pointer. Tap the scroll button and the same drag scrolls instead. Tap it again to move the pointer.
- Tap left-clicks. Tap twice for a double-click.
- Hold still, then drag, to press and drag. The grab button locks that on.
- Two-finger drag scrolls. A two-finger tap right-clicks.
- Pinch zooms the active app (Command-plus / Command-minus).

### Gyro mouse

Tap the 3D-move icon at the top to move the pointer by turning or tilting the phone, and tap it again to stop. Turning follows the rotation around gravity and tilting follows the phone's pitch, so it works held flat or upright. While gyro is on, a one-finger drag (and two-finger drag) scrolls, and tap still clicks. Settings has a gyro sensitivity slider, a **Calibrate gyro** wizard, and a Reset button. iOS asks for Motion & Orientation access the first time, and that only works over HTTPS (see below).

#### Calibrating the gyro

Settings → Calibrate gyro walks through four steps: rotate right, left, up, then down, as far as is comfortable, tapping Start and Done around each. The wizard measures how many degrees you can comfortably turn each way and sets a separate pixels-per-degree gain per direction so each edge of the screen is reachable (this fixes corners that feel harder than others). It also detects reversed axes. Run it again whenever you change how you hold the phone.

Tuning lives in `agent/tune.json` on the Mac (git-ignored), is sent to the phone on connect, and can be edited by hand: `right`, `left`, `up`, `down` (pixels per degree), `accelDiv` and `accelMax` (speed boost), `deadzone` (deg/s), `smooth` (0 to 1), `flipX`, `flipY`. Restart or reconnect to apply manual edits. Raw sensor samples and the fitted result for each run are logged to `agent/calibration/*.jsonl` so the numbers can be reviewed and tuned further.

## Buttons

Everything under the pad is an icon. Left to right, top to bottom:

| Row | Buttons |
| --- | --- |
| Keys | ⌘, ⌥, ⌃, ⇧ (stay on until tapped again, so ⌘ then C is copy), keyboard, send iPhone clipboard to Mac, copy Mac clipboard to iPhone |
| Arrows | ← ↑ ↓ → and delete. Hold to repeat. |
| Mouse | Left click, right click, drag lock, one-finger scroll, Mission Control, page up (Shift-Space), page down (Space), full screen (Control-Command-F) |
| Media | Play/pause and a volume slider |
| Browser | Back, forward, reload, new tab. Shown when Safari, Chrome, or Firefox is in front. |

Tap an app in the dock to switch to it. Hold an app, then confirm, to force quit it. New apps animate in and the dock slides when the order changes. When a browser is in front, its tabs appear above the dock. A tab shows its site icon when no other tab shares that site, otherwise its title; tap to switch, and hold a tab, then confirm, to close it. The agent fetches each icon directly from the site's own `/favicon.ico` (or page icon link) and caches it. Firefox tabs switch by position with Cmd+1/Cmd+9 and Cmd+Option+Arrow, and its list comes from Firefox's session file, which Firefox refreshes about every 15 seconds. The gear at the top opens connection, pointer speed, and scroll speed settings.

Mission Control runs `open -a "Mission Control"` on the Mac, which works even when the Control-Up keyboard shortcut is not set up.

## Clipboard and media

- **Copy from Mac:** the agent pushes the Mac's text clipboard to the phone, and one tap copies it to the iPhone clipboard.
- **Send to Mac:** reads the iPhone clipboard and writes it to the Mac. iOS shows its own Paste bubble when a page reads the clipboard; that cannot be skipped. Without HTTPS the browser blocks clipboard reading, so a small paste box opens instead: long-press, Paste, Send.

Clipboard data stays on the authenticated connection and is limited to 30,000 characters. A toast confirms each action.

The play/pause button sends the macOS system media command. Its icon follows real playback: the agent checks every 1.5 seconds whether the Mac is producing audio (through `pmset -g assertions`) and the icon shows pause while sound is playing. This is system-wide audio, not a specific player, so a muted video does not count as playing. The volume slider sets the system output volume; updates are throttled on the phone and applied one at a time on the Mac.

## Tailscale

Install Tailscale on the Mac and the phone, and sign both into the same tailnet. `npm run mac` listens on every interface, so the phone reaches it at the Mac's Tailscale address. The token is what stops other machines on that network from driving the pointer. HTTPS encrypts the link, but it does not say who is allowed in, so the token stays.

The agent listens on port 8787 and the page on port 3000.

### HTTPS over Tailscale

Plain `http://` pages cannot use the browser clipboard API, and an `https://` page can only open `wss://` sockets. So `npm run mac` and `npm run agent` run Tailscale Serve for you:

- the page at `https://<your-mac>.<tailnet>.ts.net` (port 443)
- the agent at `wss://<your-mac>.<tailnet>.ts.net:8443`

One-time setup in the Tailscale admin console: turn on MagicDNS and HTTPS Certificates. Then open the printed `https://…/#t=TOKEN` link on the phone (add it to the Home Screen again, because it is a new origin). The agent address fills itself in on `.ts.net` pages.

If Serve cannot start automatically (the Tailscale app's CLI sometimes refuses outside a terminal), run these once in Terminal. The CLI lives at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` if `tailscale` is not on your PATH:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```

Set `NO_TAILSCALE_HTTPS=1` to skip the automatic setup. The old `http://100.x.x.x:3000` link keeps working.

Serve is not a speed feature. It adds a local proxy hop, which is negligible. Latency depends on whether the phone reaches the Mac directly or through a Tailscale relay (`tailscale status` shows `direct` or `relay`).

## Deploy the page to Vercel

Vercel can host the touch UI, but it cannot move the Mac. Deploy as usual:

```bash
npx vercel
```

Keep the agent running on the Mac with Serve on port 8443, then set the Mac agent in Settings to `wss://<your-mac>.<tailnet>.ts.net:8443` and paste the token. For the lowest delay, skip Vercel and open the link printed on the Mac.
