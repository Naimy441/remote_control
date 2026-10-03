A phone trackpad for a Mac on your Tailscale network.

The page is a Next.js app. The thing that actually moves the pointer is a small agent that has to run on the Mac, because a website cannot inject mouse or keyboard events by itself. Your phone opens the page over Tailscale and sends gestures straight to that agent.

This is meant for your own tailnet. Do not port-forward it, and do not put it on Tailscale Funnel. Anyone with the token can drive the Mac.

## Requirements

- A Mac with the Xcode command line tools (`swiftc` compiles the input helper, the app list, and the menu bar control)
- Node.js 20 or newer
- Tailscale on the Mac and on the phone, signed into the same tailnet
- Accessibility permission for the app that launches RC: Remote Control from the menu bar, or your terminal app (asked for on first launch)

## Run it

On the Mac, once:

```bash
npm install
npm run app
```

This installs **Remote Control** in `/Applications` (or `~/Applications` if `/Applications` is not writable) and opens it. From then on, open Remote Control from Spotlight (⌘ Space, "Remote Control") like any other app. Opening it starts RC in the background and shows the `RC` menu with the phone link. Opening it again while it runs shows the menu again, and starts RC if it was stopped. Quit Remote Control from its menu stops everything. Turn on **Open at Login** in the same menu to have RC start with the Mac.

To run in a terminal instead, with the server output in front of you:

```bash
npm run mac
```

The terminal prints a link and a token. On the phone, turn Tailscale on and open that link (the `https://` one if it is listed; see [HTTPS over Tailscale](#https-over-tailscale)). The token in the link signs you in once and is then stored on the phone.

The first run creates `agent/.token` (mode `600`). That file, the printed links in `agent/link.txt`, and the compiled helpers in `agent/bin/` stay on the machine. They are listed in `.gitignore`. To issue a new token, stop the agent, delete `agent/.token`, and start again. You can also set `AGENT_TOKEN` in the environment instead of using the file.

`RC` appears in the Mac menu bar, next to Wi-Fi and Control Center. Use it to start or stop, or to copy the phone link. Stopping from the menu quits this command. `RC` stays, so you can start again without opening Terminal. Quit Remote Control stops RC and removes `RC` from the menu bar; open the app again to bring it back. `npm run mac` and `npm run app` rebuild the app when `agent/menu.swift` changes.

If `RC` is missing from the menu bar while the app is running, the menu bar is probably full: on a Mac with a camera notch, macOS hides the items that do not fit behind it, without saying so. Open Remote Control again; when it cannot see its own menu bar item, it shows a window with Start/Stop and Copy Phone Link instead. Quitting a menu bar app you do not need, or holding ⌘ and dragging `RC` further right, makes room. Also check that Remote Control is allowed under System Settings → Menu Bar.

Accessibility permission is attributed to the app that launched RC, not to the helper itself. Started from the menu bar, that is **Remote Control** (the menu bar app); started with `npm run mac` in Terminal, it is **Terminal** (or iTerm, VS Code, and so on). Turn that app on in System Settings → Privacy & Security → Accessibility. The menu bar shows "Running, needs Accessibility" and an **Allow Accessibility for RC…** item until it is granted. If the pointer still does not move, quit RC and start it again.

Only one entry is needed. If the list has stale RemoteInput or RemoteMenu entries from older builds, select them and press `−`, then add `/Applications/Remote Control.app` with `+`.

Helpers are signed with your Apple Development certificate when one is in your keychain (set `RC_SIGN_IDENTITY` to pick another), using fixed identifiers. macOS ties Accessibility, Automation and folder permissions to the signature, and an ad-hoc signature changes on every rebuild, so with a certificate each grant sticks. Without one it falls back to ad hoc and the prompts come back after each rebuild.

No Apple certificate? Run `npm run setup-signing` once. It creates a self-signed code-signing certificate named `RC Local Signing` in your login keychain (macOS asks for your password to trust it), and the helpers use it automatically. Choose Always Allow if Keychain asks whether `codesign` may use the key. Each person who builds this on their own Mac does this on that Mac; permissions are per machine and certificates are not shared.

Firefox, Chrome, and Safari tab switching may also ask for Automation permission under Privacy & Security → Automation.

## Add it to your Home Screen

You get a noticeably better experience if you run the page as a Home Screen app instead of a Safari tab:

- **Full screen.** Safari's address bar and toolbar disappear, so the trackpad gets that space too, and nothing slides in over the controls.
- **Fewer accidents.** There is no Safari toolbar to tap by mistake and no page to pull down or swipe away.
- **Opens like an app.** One tap from the Home Screen, with its own icon and entry in the app switcher.
- **Remembers you.** The agent address, token, settings and quick buttons are kept for the app, so you connect once.

On the iPhone, open the `https://` link from the Mac in Safari, tap **Share**, then **Add to Home Screen**, and launch it from the new icon. The Home Screen app keeps its own storage, so open the link with the token (`…/#t=TOKEN`) once from the icon, or enter the address and token under Settings.

Notes:

- iOS reads the page's app settings (status bar style and the like) when you add the icon. If the layout ever looks off after an update, delete the icon and add it again.
- Dictation can be limited in Home Screen apps. When it is, the mic button opens the keyboard so you can use the keyboard's own mic key.
- Settings → Display shows the window, screen and safe-area sizes, which helps when something does not fit the screen.

## Gestures

The pad tracks at most two fingers, each shown as a glowing ring.

- One finger drag moves the pointer. Tap the scroll button and the same drag scrolls instead. Tap it again to move the pointer.
- Tap left-clicks. Tap twice for a double-click.
- Hold still, then drag, to press and drag. The grab button locks that on.
- Two-finger drag scrolls. A two-finger tap right-clicks.
- Pinch zooms the active app (Command-plus / Command-minus).

### Gyro pointer

Tap the 3D-move icon at the top, hold the phone in portrait, and point its top edge at the screen like a remote or laser pointer. The phone's angle maps straight to a position on the Mac screen: the direction you point when you turn it on (or tap the crosshair to recenter) is the middle of the screen, and the edges sit at the ends of your comfortable wrist range. There is no pointer drift or getting stuck in corners, because position is a function of angle.

- **Clicks and scrolling:** tap clicks and a finger drag scrolls. While a finger is on the pad (and for a moment after), the pointer is held at where it was just before the touch, so tapping does not jostle the aim.
- **Hand tremor:** the aim is smoothed with a one-euro filter. Small shakes are filtered heavily while the pointer is nearly still, and the filter opens up for fast sweeps so quick moves have little lag.
- **Recenter:** orientation sensors drift slowly in heading, so tap the crosshair that appears next to the gyro icon whenever the middle of the screen feels off.
- The Gyro slider in Settings scales the range, **Calibrate gyro** fits it to you, and iOS asks for Motion & Orientation access the first time (HTTPS only, see below).

#### Calibrating the gyro

Settings → Calibrate gyro walks through four steps: turn right, left, up, then down, as far as is comfortable, tapping Start and Done around each. The wizard measures the angle you can comfortably cover each way and sets a separate pixels-per-degree gain per direction so each screen edge is reachable. It also detects reversed axes. Gains are bounded to 20–45 px/deg. Run it again when you change how you hold the phone.

Tuning lives in `agent/tune.json` on the Mac (git-ignored), is sent to the phone on connect, and can be edited by hand: `right`, `left`, `up`, `down` (pixels per degree), `minCutoff` (Hz, lower removes more tremor but adds lag when still) and `beta` (higher means less lag in fast moves), `flipX`, `flipY`. Reconnect to apply manual edits. Raw sensor samples and the fitted result for each run are logged to `agent/calibration/*.jsonl`.

## Buttons

Everything under the pad is an icon. Left to right, top to bottom:

| Row | Buttons |
| --- | --- |
| Keys | ⌘, ⌥, ⌃, ⇧ (stay on until tapped again, so ⌘ then C is copy), keyboard, send iPhone clipboard to Mac, copy Mac clipboard to iPhone |
| Arrows | ← ↑ ↓ → and delete. Hold to repeat. |
| Mouse | Left click, right click, drag lock, one-finger scroll, Mission Control, page up (Shift-Space), page down (Space), full screen (Control-Command-F) |
| Media and browser | A play/pause button (it shows pause while audio is playing and play when it is not), a volume slider, and back, forward, reload and new tab on the same row. The browser buttons show when Safari, Chrome, or Firefox is in front. |

The microphone button next to the keyboard dictates into whatever is focused on the Mac. It uses the browser's speech recognition (Safari on iPhone) over HTTPS, shows a live preview of the latest words it hears at the bottom of the pad, and types each finished phrase on the Mac as plain text, even if a modifier is toggled on. It keeps listening through pauses until you tap the mic again, and stops if you leave the page or lose the connection. If speech recognition is unavailable or blocked (it can be limited in Home Screen web apps), it opens the keyboard so you can use the keyboard's own mic key, which also types on the Mac.

**Typing:** when the phone keyboard opens, every control stays on screen. The quick rail and the hint text disappear at once and the trackpad animates down to the space that is left; when the keyboard closes the trackpad grows back and the rail fades in after it has finished.

**Left-handed mode** (Settings → Handedness) moves the quick buttons to the left edge of the trackpad and makes the app dock and web tabs start from the left, so the most recent ones sit under your left thumb. The default is right-handed, with everything on the right.

**Settings** (the gear on the trackpad) opens as a full page with sections for the connection, pointer and scroll speed, the gyro pointer, and quick buttons.

**Quick buttons** are a rail of round buttons on the right edge of the trackpad. By default it holds keyboard, dictate, enter and scroll lock. Five show at a time, the outer ones smaller and faded so it is clear there are more; swipe the rail to bring the others in. At rest the rail shrinks and tucks against the edge, and it grows back while you touch or scroll it. It hides while the phone keyboard is open. In Settings → Quick buttons you can add, remove and reorder the buttons the app already has: keyboard, dictate, enter, backspace, the four arrow keys (hold to repeat), scroll lock, left and right click, drag lock, Mission Control, full screen, page up and down, play/pause, and the browser back, forward, reload and new tab buttons. The list is saved on the phone.

The dock lists your open apps from right to left with the most recently used first, so the app you were just in is always at the right edge, under your thumb, and older apps run off to the left.

Tap an app in the dock to switch to it. Hold an app, then confirm, to force quit it. New apps animate in and the dock slides when the order changes. When a browser is in front, its tabs appear above the dock, also running right to left. Settings → Web tabs → **Always show web tabs** keeps the strip up for every open browser, not just the one in front. With more than one browser open, each gets its own group led by its app icon, separated by a thin divider, with the most recently used browser first; tapping a tab in another browser brings that browser forward. A tab shows its site icon when no other tab shares that site and the site has an icon of its own; otherwise it shows its title; tap to switch, and hold a tab, then confirm, to close it. The agent fetches each icon directly from the site's own `/favicon.ico` (or page icon link) and caches it. Firefox tabs switch by position with Cmd+1/Cmd+9 and Cmd+Option+Arrow, and its list comes from Firefox's session file, which Firefox refreshes about every 15 seconds. The gear at the top opens connection, pointer speed, and scroll speed settings.

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
