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

The terminal prints a link and a token. On the phone, turn Tailscale on and open that link. The token in the link signs you in once and is then stored on the phone.

The first run creates `agent/.token` (mode `600`). That file, the printed links in `agent/link.txt`, and the compiled helpers in `agent/bin/` stay on the machine. They are listed in `.gitignore`. To issue a new token, stop the agent, delete `agent/.token`, and start again. You can also set `AGENT_TOKEN` in the environment instead of using the file.

`RC` appears in the Mac menu bar, next to Wi-Fi and Control Center. Use it to start or stop, or to copy the phone link. Stopping from the menu quits this command. `RC` stays, so you can start again without opening Terminal. Remove from menu bar hides it; the next `npm run mac` puts it back.

The first launch asks for Accessibility permission for `RemoteInput`. Allow it in System Settings → Privacy & Security → Accessibility. If the pointer still does not move, quit `npm run mac` and start it again. Recompiling `RemoteInput` can make macOS forget that permission, so allow it again if the pointer stops after an update.

Firefox, Chrome, and Safari tab switching may also ask for Automation permission under Privacy & Security → Automation.

## Gestures

- One finger drag moves the pointer. Tap **Scroll** and the same drag scrolls instead. Tap it again to move the pointer.
- Tap left-clicks. Tap twice for a double-click.
- Hold still, then drag, to press and drag. The Drag button locks that on.
- Two-finger drag scrolls. A two-finger tap right-clicks.
- Page down sends Space. Page up sends Shift-Space. Full screen sends Control-Command-F.
- Tap an open app to switch to it. Hold an app, then confirm, to force quit it.
- When Safari, Chrome, or Firefox is in front, its tabs appear, and Back, Forward, Reload, and New tab show under the pad.
- Keyboard opens the phone keyboard and types on the Mac. ⌘ ⌥ ⌃ ⇧ stay on until you tap them again, so ⌘ then C is copy.

Pointer speed and scroll speed are under Settings.

## Tailscale

Install Tailscale on the Mac and the phone, and sign both into the same tailnet. `npm run mac` listens on every interface, so the phone reaches it at the Mac’s Tailscale address. The token is what stops other machines on that network from driving the pointer.

The agent listens on port 8787. The page listens on port 3000. Opening the printed link is enough; the page finds the agent on the same host.

## Deploy the page to Vercel

Vercel can host the touch UI, but it cannot move the Mac. Deploy as usual:

```bash
npx vercel
```

On the Mac, keep the agent running (`npm run agent`). From the phone, the Vercel page is HTTPS, so the agent address has to be a secure websocket. Tailscale Serve can do that without exposing the Mac to the public internet:

```bash
tailscale serve --bg 8787
```

In the page, set the Mac agent to `wss://<your-mac>.<tailnet>.ts.net` and paste the token. For the lowest delay, skip Vercel and open the `http://100.x.x.x:3000` link printed on the Mac.
