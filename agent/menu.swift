import AppKit
import ApplicationServices
import Darwin
import ServiceManagement

// `npm run mac` opens this app with the project root and node as arguments. Opened from Spotlight,
// Finder or at login there are no arguments, and the project root comes from the RCProjectRoot key
// that the installer writes into Info.plist.
let launchedByScript = CommandLine.arguments.count > 1 && !CommandLine.arguments[1].hasPrefix("-psn")
let plistRoot = (Bundle.main.object(forInfoDictionaryKey: "RCProjectRoot") as? String).flatMap { $0.isEmpty ? nil : $0 }
let root = URL(
  fileURLWithPath: launchedByScript
    ? CommandLine.arguments[1]
    : (plistRoot ?? FileManager.default.currentDirectoryPath),
  isDirectory: true
)
let binDir = root.appendingPathComponent("agent/bin", isDirectory: true)
let pidFile = binDir.appendingPathComponent("remote.pid")
let menuPidFile = binDir.appendingPathComponent("menu.pid")
let linkFile = root.appendingPathComponent("agent/link.txt")
let logFile = binDir.appendingPathComponent("remote.log")
let macScript = root.appendingPathComponent("scripts/mac.mjs").path
let nodeHintFile = binDir.appendingPathComponent("node-path")

// Login items get a bare PATH, so node (often installed by nvm) has to be found explicitly:
// the path `npm run mac` last used, then the user's login shell.
func resolveNode() -> String? {
  if launchedByScript, CommandLine.arguments.count > 2, FileManager.default.isExecutableFile(atPath: CommandLine.arguments[2]) {
    return CommandLine.arguments[2]
  }
  if let hint = try? String(contentsOf: nodeHintFile, encoding: .utf8)
    .trimmingCharacters(in: .whitespacesAndNewlines),
    FileManager.default.isExecutableFile(atPath: hint) {
    return hint
  }
  let shell = Process()
  let pipe = Pipe()
  shell.executableURL = URL(fileURLWithPath: "/bin/zsh")
  shell.arguments = ["-l", "-i", "-c", "command -v node"]
  shell.standardOutput = pipe
  shell.standardError = FileHandle.nullDevice
  try? shell.run()
  shell.waitUntilExit()
  let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let found = output.split(whereSeparator: \.isNewline).map(String.init).last ?? ""
  return FileManager.default.isExecutableFile(atPath: found) ? found : nil
}

func readPid(_ url: URL) -> Int32? {
  guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
  return Int32(text.trimmingCharacters(in: .whitespacesAndNewlines))
}

func alive(_ pid: Int32) -> Bool {
  pid > 0 && kill(pid, 0) == 0
}

let ownPid = Int32(ProcessInfo.processInfo.processIdentifier)
let showNotice = Notification.Name("local.remote-control.menu.show")
// Only one RC menu. A second copy asks the running one to show itself, then leaves. This checks
// running apps rather than menu.pid, which can be stale or point at a reused process id.
let others = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "local.remote-control.menu")
  .filter { $0.processIdentifier != ownPid }
if !others.isEmpty {
  if !launchedByScript {
    DistributedNotificationCenter.default().postNotificationName(showNotice, object: nil, userInfo: nil, deliverImmediately: true)
  }
  exit(0)
}
try? FileManager.default.createDirectory(at: binDir, withIntermediateDirectories: true)
try? String(ownPid).write(to: menuPidFile, atomically: true, encoding: .utf8)

func shellQuote(_ value: String) -> String {
  "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

final class MenuApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
  static let shared = MenuApp()
  var status: NSStatusItem?
  let menu = NSMenu()
  var menuOpen = false

  func start() {
    NSApplication.shared.setActivationPolicy(.accessory)
    NSApplication.shared.delegate = self
    NSApplication.shared.run()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let event = NSAppleEventManager.shared().currentAppleEvent
    let atLogin = event?.eventID == AEEventID(kAEOpenApplication)
      && event?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status = item
    item.autosaveName = "RC"
    item.isVisible = true
    if let button = item.button {
      button.image = nil
      button.title = "RC"
      button.imagePosition = .noImage
      button.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
      button.toolTip = "Remote control"
      item.length = button.intrinsicContentSize.width
    }
    menu.delegate = self
    item.menu = menu
    rebuild()
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      self?.rebuild()
    }
    DistributedNotificationCenter.default().addObserver(forName: showNotice, object: nil, queue: .main) { [weak self] _ in
      self?.open()
    }
    // Opening the app is how RC is started. `npm run mac` starts the server itself.
    if !launchedByScript {
      if serverPid() == nil { startServer() }
      if !atLogin {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.reveal() }
      }
    }
  }

  // Opening the app again from Spotlight, Finder or the Dock while it is running.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    open()
    return false
  }

  func open() {
    if serverPid() == nil { startServer() }
    reveal()
  }

  // A full menu bar hides the items that do not fit behind the camera notch, and macOS gives no
  // sign of it. When RC is not on screen, say so in a window instead of opening a menu nobody sees.
  func onScreen() -> Bool {
    guard let window = status?.button?.window, let screen = window.screen else { return false }
    if !window.occlusionState.contains(.visible) { return false }
    if let right = screen.auxiliaryTopRightArea {
      return window.frame.minX >= right.minX - 1 && window.frame.maxX <= right.maxX + 1
    }
    return screen.frame.intersects(window.frame)
  }

  func reveal() {
    if onScreen() {
      status?.button?.performClick(nil)
      return
    }
    NSApp.activate(ignoringOtherApps: true)
    let running = serverPid() != nil
    let alert = NSAlert()
    alert.messageText = running ? "Remote Control is running" : "Remote Control is stopped"
    alert.informativeText = "RC is in the menu bar, but macOS is hiding it, usually because the menu bar is full and RC ended up behind the camera notch. Quit a menu bar app you do not need, or hold ⌘ and drag RC further right. Also check that Remote Control is allowed under System Settings → Menu Bar.\n\nOpen Remote Control again any time to see this."
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: running ? "Stop" : "Start")
    let link = links().first
    if link != nil { alert.addButton(withTitle: "Copy Phone Link") }
    switch alert.runModal() {
    case .alertSecondButtonReturn:
      if running { stopServer() } else { startServer() }
    case .alertThirdButtonReturn:
      if let link {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(link, forType: .string)
      }
    default:
      break
    }
  }

  func serverPid() -> Int32? {
    guard let pid = readPid(pidFile), alive(pid) else { return nil }
    return pid
  }

  func links() -> [String] {
    guard let text = try? String(contentsOf: linkFile, encoding: .utf8) else { return [] }
    return text.split(whereSeparator: \.isNewline).map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  func rebuild() {
    let running = serverPid() != nil
    status?.button?.appearsDisabled = !running
    if menuOpen { return }
    menu.removeAllItems()
    let allowed = AXIsProcessTrusted()
    let label = running ? (allowed ? "Running" : "Running, needs Accessibility") : "Stopped"
    let state = NSMenuItem(title: label, action: nil, keyEquivalent: "")
    state.isEnabled = false
    menu.addItem(state)
    if !allowed {
      // macOS attributes the input helper's Accessibility check to the app that launched it,
      // which is this menu bar app, so the permission has to be granted to "Remote Control".
      menu.addItem(item("Allow Accessibility for RC…", #selector(askAccessibility)))
    }
    menu.addItem(.separator())
    if running {
      menu.addItem(item("Stop", #selector(stopServer)))
    } else {
      menu.addItem(item("Start", #selector(startServer)))
    }
    let urls = links()
    if !urls.isEmpty {
      menu.addItem(.separator())
      for url in urls {
        let entry = item(url, #selector(copyLink(_:)))
        entry.representedObject = url
        menu.addItem(entry)
      }
      let hint = NSMenuItem(title: "Click a link to copy it", action: nil, keyEquivalent: "")
      hint.isEnabled = false
      menu.addItem(hint)
    }
    menu.addItem(.separator())
    let login = item("Open at Login", #selector(toggleLogin))
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menu.addItem(login)
    let quit = item("Quit Remote Control", #selector(quitMenu))
    quit.keyEquivalent = "q"
    menu.addItem(quit)
  }

  func item(_ title: String, _ action: Selector) -> NSMenuItem {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    return entry
  }

  @objc func askAccessibility() {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
      NSWorkspace.shared.open(url)
    }
  }

  @objc func startServer() {
    if serverPid() != nil { return }
    if !AXIsProcessTrusted() {
      askAccessibility()
      flash("RC!", "Turn on Remote Control in Privacy & Security → Accessibility, then press Start again.")
      return
    }
    guard let nodePath = resolveNode() else {
      flash("RC!", "Could not find node. Run npm run mac once in Terminal.")
      return
    }
    let command = "cd \(shellQuote(root.path)) && nohup \(shellQuote(nodePath)) \(shellQuote(macScript)) >> \(shellQuote(logFile.path)) 2>&1 &"
    let shell = Process()
    shell.executableURL = URL(fileURLWithPath: "/bin/sh")
    shell.arguments = ["-c", command]
    try? shell.run()
    shell.waitUntilExit()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.rebuild() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
      if self.serverPid() == nil {
        self.flash("RC!", "Could not start. See agent/bin/remote.log")
      }
    }
  }

  func flash(_ title: String, _ tip: String) {
    status?.button?.title = title
    status?.button?.toolTip = tip
    DispatchQueue.main.asyncAfter(deadline: .now() + 6) {
      self.status?.button?.title = "RC"
      self.status?.button?.toolTip = "Remote control"
    }
  }

  @objc func stopServer() {
    guard let pid = serverPid() else { return }
    kill(pid, SIGTERM)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.rebuild() }
  }

  @objc func copyLink(_ sender: NSMenuItem) {
    guard let text = sender.representedObject as? String, !text.isEmpty else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    status?.button?.toolTip = "Copied"
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
      self.status?.button?.toolTip = "Remote control"
    }
  }

  @objc func toggleLogin() {
    let service = SMAppService.mainApp
    do {
      if service.status == .enabled {
        try service.unregister()
      } else {
        try service.register()
      }
    } catch {
      flash("RC!", "Could not change Open at Login: \(error.localizedDescription)")
    }
    if service.status == .requiresApproval {
      SMAppService.openSystemSettingsLoginItems()
    }
    rebuild()
  }

  // Quitting the app stops RC too, like any other app.
  @objc func quitMenu() {
    if let pid = serverPid() { kill(pid, SIGTERM) }
    if readPid(menuPidFile) == ownPid {
      try? FileManager.default.removeItem(at: menuPidFile)
    }
    NSApp.terminate(nil)
  }

  @objc func menuWillOpen(_ menu: NSMenu) {
    menuOpen = false
    rebuild()
    menuOpen = true
  }

  @objc func menuDidClose(_ menu: NSMenu) {
    menuOpen = false
  }
}

MenuApp.shared.start()
