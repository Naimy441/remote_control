import AppKit
import Darwin

// When macOS opens this app at login it passes no arguments and the working directory is "/".
// The project root is then recovered from the bundle location (<root>/agent/bin/RemoteMenu.app).
let bundleSuffix = "/agent/bin/RemoteMenu.app"
let bundleRoot: String? = Bundle.main.bundlePath.hasSuffix(bundleSuffix)
  ? String(Bundle.main.bundlePath.dropLast(bundleSuffix.count))
  : nil
let root = URL(
  fileURLWithPath: CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : (bundleRoot ?? FileManager.default.currentDirectoryPath),
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
  if CommandLine.arguments.count > 2, FileManager.default.isExecutableFile(atPath: CommandLine.arguments[2]) {
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
if let existing = readPid(menuPidFile), existing != ownPid, alive(existing) {
  exit(0)
}
try? FileManager.default.createDirectory(at: binDir, withIntermediateDirectories: true)
try? String(ownPid).write(to: menuPidFile, atomically: true, encoding: .utf8)

func shellQuote(_ value: String) -> String {
  "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

final class MenuApp: NSObject, NSMenuDelegate {
  static let shared = MenuApp()
  var status: NSStatusItem?
  let menu = NSMenu()
  var menuOpen = false

  func start() {
    NSApplication.shared.setActivationPolicy(.accessory)
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status = item
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
    NSApplication.shared.run()
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
    let state = NSMenuItem(title: running ? "Running" : "Stopped", action: nil, keyEquivalent: "")
    state.isEnabled = false
    menu.addItem(state)
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
    menu.addItem(item("Remove from menu bar", #selector(quitMenu)))
  }

  func item(_ title: String, _ action: Selector) -> NSMenuItem {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    return entry
  }

  @objc func startServer() {
    if serverPid() != nil { return }
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

  @objc func quitMenu() {
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
