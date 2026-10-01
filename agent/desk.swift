import AppKit
import Foundation

NSApplication.shared.setActivationPolicy(.prohibited)

var icons: [String: String] = [:]

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
        let text = String(data: data, encoding: .utf8) else { return }
  print(text)
  fflush(stdout)
}

func pngBase64(_ image: NSImage) -> String {
  let pixels = 64
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else { return "" }
  rep.size = NSSize(width: 32, height: 32)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSGraphicsContext.current?.imageInterpolation = .high
  image.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
  NSGraphicsContext.restoreGraphicsState()
  guard let data = rep.representation(using: .png, properties: [:]) else { return "" }
  return data.base64EncodedString()
}

func icon(for app: NSRunningApplication) -> String {
  let id = app.bundleIdentifier ?? ""
  if let cached = icons[id], !cached.isEmpty { return cached }
  let image = app.icon ?? NSImage(size: NSSize(width: 32, height: 32))
  let encoded = pngBase64(image)
  if !encoded.isEmpty { icons[id] = encoded }
  return encoded
}

func snapshot(_ id: Int) {
  let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
  var seen = Set<String>()
  var apps: [[String: Any]] = []
  for app in NSWorkspace.shared.runningApplications {
    guard !app.isTerminated,
          app.activationPolicy == .regular,
          let bundle = app.bundleIdentifier,
          !bundle.isEmpty,
          seen.insert(bundle).inserted else { continue }
    let name = app.localizedName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !name.isEmpty else { continue }
    apps.append([
      "id": bundle,
      "name": name,
      "icon": icon(for: app),
    ])
  }
  apps.sort { a, b in
    let aId = a["id"] as? String ?? ""
    let bId = b["id"] as? String ?? ""
    if aId == front { return true }
    if bId == front { return false }
    let aName = a["name"] as? String ?? ""
    let bName = b["name"] as? String ?? ""
    return aName.localizedCaseInsensitiveCompare(bName) == .orderedAscending
  }
  emit(["id": id, "ok": true, "front": front, "apps": apps])
}

func focus(_ id: Int, bundle: String) {
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first(where: { !$0.isTerminated }) else {
    emit(["id": id, "ok": false])
    return
  }
  if app.isHidden { app.unhide() }
  let ok = app.activate(options: [.activateAllWindows])
  emit(["id": id, "ok": ok])
}

func quit(_ id: Int, bundle: String) {
  let matches = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).filter { !$0.isTerminated }
  if matches.isEmpty {
    emit(["id": id, "ok": false])
    return
  }
  var ok = false
  for app in matches where app.forceTerminate() {
    ok = true
  }
  emit(["id": id, "ok": ok])
}

func handle(_ line: String) {
  guard let data = line.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data),
        let object = json as? [String: Any] else { return }
  let id = (object["id"] as? NSNumber)?.intValue ?? 0
  switch object["op"] as? String ?? "" {
  case "snapshot":
    snapshot(id)
  case "focus":
    focus(id, bundle: object["bundle"] as? String ?? "")
  case "quit":
    quit(id, bundle: object["bundle"] as? String ?? "")
  default:
    emit(["id": id, "ok": false])
  }
}

let center = NSWorkspace.shared.notificationCenter
func noteApps() {
  emit(["event": "apps"])
}
let observers = [
  center.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { _ in noteApps() },
  center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { _ in noteApps() },
  center.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in noteApps() },
]
_ = observers

DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine(strippingNewline: true) {
    let command = line
    DispatchQueue.main.async {
      handle(command)
    }
  }
  DispatchQueue.main.async {
    exit(0)
  }
}

NSApplication.shared.run()
