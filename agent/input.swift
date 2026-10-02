import ApplicationServices
import AppKit
import Carbon
import CoreGraphics
import Darwin
import Foundation
import IOKit.hidsystem

let dryRun = CommandLine.arguments.contains("--dry-run")
let source: CGEventSource? = CGEventSource(stateID: .hidSystemState)
source?.localEventsSuppressionInterval = 0

var flags: CGEventFlags = []
var heldButton: CGMouseButton?
var cursor = CGEvent(source: nil)?.location ?? .zero
var lastSync = Date.distantPast
var naturalScroll = true
var naturalScrollChecked = Date.distantPast

let keyCodes: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
  "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26, "8": 28, "0": 29,
  "-": 27, "=": 24,
  "o": 31, "u": 32, "i": 34, "p": 35, "return": 36, "l": 37, "j": 38, "k": 40,
  "n": 45, "m": 46, "tab": 48, "space": 49, "delete": 51, "escape": 53,
  "left": 123, "right": 124, "down": 125, "up": 126,
  "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
]

func log(_ message: String) {
  fputs(message + "\n", stderr)
  fflush(stderr)
}

func number(_ object: [String: Any], _ key: String) -> Double {
  let value = object[key]
  if let number = value as? NSNumber { return number.doubleValue }
  if let double = value as? Double { return double }
  if let int = value as? Int { return Double(int) }
  return 0
}

func bool(_ object: [String: Any], _ key: String) -> Bool {
  let value = object[key]
  if let flag = value as? Bool { return flag }
  if let number = value as? NSNumber { return number.boolValue }
  return false
}

func string(_ object: [String: Any], _ key: String) -> String {
  object[key] as? String ?? ""
}

func button(named name: String) -> CGMouseButton {
  switch name {
  case "right": return .right
  case "center": return .center
  default: return .left
  }
}

func downType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right: return .rightMouseDown
  case .center: return .otherMouseDown
  default: return .leftMouseDown
  }
}

func upType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right: return .rightMouseUp
  case .center: return .otherMouseUp
  default: return .leftMouseUp
  }
}

func dragType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right: return .rightMouseDragged
  case .center: return .otherMouseDragged
  default: return .leftMouseDragged
  }
}

func clampInt(_ value: Double, limit: Double) -> Int32 {
  if !value.isFinite { return 0 }
  let capped = min(limit, max(-limit, value))
  return Int32(capped.rounded())
}

func naturalScrollEnabled() -> Bool {
  if Date().timeIntervalSince(naturalScrollChecked) < 5 { return naturalScroll }
  naturalScrollChecked = Date()
  let key = "com.apple.swipescrolldirection" as CFString
  if let value = CFPreferencesCopyAppValue(key, kCFPreferencesAnyApplication) {
    if let flag = value as? Bool {
      naturalScroll = flag
    } else if let number = value as? NSNumber {
      naturalScroll = number.boolValue
    }
  } else {
    naturalScroll = true
  }
  return naturalScroll
}

func liveCursor() -> CGPoint {
  CGEvent(source: nil)?.location ?? cursor
}

func syncedCursor() -> CGPoint {
  if Date().timeIntervalSince(lastSync) > 0.15 {
    cursor = liveCursor()
    lastSync = Date()
  }
  return cursor
}

func place(_ point: CGPoint, type: CGEventType, button: CGMouseButton, clickState: Int64 = 0) {
  cursor = point
  lastSync = Date()
  if dryRun {
    log("DRY \(type.rawValue) \(point.x) \(point.y)")
    return
  }
  let moving = type == .mouseMoved || type == .leftMouseDragged || type == .rightMouseDragged || type == .otherMouseDragged
  if moving {
    CGWarpMouseCursorPosition(point)
    CGAssociateMouseAndMouseCursorPosition(1)
  }
  guard let event = CGEvent(
    mouseEventSource: source,
    mouseType: type,
    mouseCursorPosition: point,
    mouseButton: button
  ) else { return }
  event.flags = flags
  if button == .center {
    event.setIntegerValueField(.mouseEventButtonNumber, value: 2)
  }
  if clickState > 0 {
    event.setIntegerValueField(.mouseEventClickState, value: clickState)
  }
  event.post(tap: .cghidEventTap)
}

// Keep the tracked pointer on a display. macOS clamps the real cursor at the screen edge, but
// this tracked position would keep growing past it during continuous motion (it only resyncs
// after a pause), so leaving a corner meant first unwinding all the overshoot.
func clampToDisplays(_ point: CGPoint) -> CGPoint {
  var count: UInt32 = 0
  var ids = [CGDirectDisplayID](repeating: 0, count: 16)
  guard CGGetActiveDisplayList(16, &ids, &count) == .success, count > 0 else { return point }
  var best = point
  var bestDistance = Double.infinity
  for id in ids.prefix(Int(count)) {
    let bounds = CGDisplayBounds(id)
    let clamped = CGPoint(
      x: min(max(point.x, bounds.minX), bounds.maxX - 1),
      y: min(max(point.y, bounds.minY), bounds.maxY - 1)
    )
    let distance = hypot(clamped.x - point.x, clamped.y - point.y)
    if distance < bestDistance {
      bestDistance = distance
      best = clamped
    }
  }
  return best
}

func move(dx: Double, dy: Double) {
  guard dx.isFinite, dy.isFinite, dx != 0 || dy != 0 else { return }
  var point = syncedCursor()
  point.x += dx
  point.y += dy
  point = clampToDisplays(point)
  if let held = heldButton {
    place(point, type: dragType(held), button: held)
  } else {
    place(point, type: .mouseMoved, button: .left)
  }
}

func mouseDown(_ button: CGMouseButton) {
  if let held = heldButton, held != button {
    mouseUp(held)
  }
  heldButton = button
  place(syncedCursor(), type: downType(button), button: button, clickState: 1)
}

func mouseUp(_ button: CGMouseButton) {
  place(syncedCursor(), type: upType(button), button: button, clickState: 1)
  if heldButton == button { heldButton = nil }
}

func releaseHeld() {
  if let held = heldButton { mouseUp(held) }
}

func performClick(_ button: CGMouseButton, count: Int) {
  releaseHeld()
  let point = syncedCursor()
  let state = Int64(max(1, min(count, 3)))
  place(point, type: downType(button), button: button, clickState: state)
  if !dryRun { Thread.sleep(forTimeInterval: 0.016) }
  place(point, type: upType(button), button: button, clickState: state)
}

func scroll(dx: Double, dy: Double) {
  guard dx.isFinite, dy.isFinite else { return }
  let natural = naturalScrollEnabled()
  let wheelY = clampInt(natural ? dy : -dy, limit: 6000)
  let wheelX = clampInt(natural ? dx : -dx, limit: 6000)
  if wheelX == 0 && wheelY == 0 { return }
  if dryRun {
    log("DRY scroll \(wheelX) \(wheelY)")
    return
  }
  guard let event = CGEvent(
    scrollWheelEvent2Source: source,
    units: .pixel,
    wheelCount: 2,
    wheel1: wheelY,
    wheel2: wheelX,
    wheel3: 0
  ) else { return }
  event.flags = flags
  event.post(tap: .cghidEventTap)
}

func postKey(name: String, down: Bool) {
  guard let code = keyCodes[name] else {
    log("ignored key \(name)")
    return
  }
  if dryRun {
    log("DRY key \(name) \(down)")
    return
  }
  guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
  event.flags = flags
  event.post(tap: .cghidEventTap)
}

func postMediaToggle() {
  // System-defined media events reach the active player (including a playing
  // browser video) instead of sending a space character to the focused page.
  let keyDown = 0xA
  let keyUp = 0xB
  for state in [keyDown, keyUp] {
    let data1 = (Int(NX_KEYTYPE_PLAY) << 16) | (state << 8)
    guard let event = NSEvent.otherEvent(
      with: .systemDefined,
      location: .zero,
      modifierFlags: [],
      timestamp: 0,
      windowNumber: 0,
      context: nil,
      subtype: Int16(NX_SUBTYPE_AUX_CONTROL_BUTTONS),
      data1: data1,
      data2: -1
    ) else { return }
    event.cgEvent?.post(tap: .cghidEventTap)
  }
}

func layoutKey(for character: Character) -> (code: CGKeyCode, flags: CGEventFlags)? {
  let units = Array(String(character).utf16)
  guard units.count == 1 else { return nil }
  let target = units[0]

  guard let source = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
        let property = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
  let data = unsafeBitCast(property, to: CFData.self)
  guard let bytes = CFDataGetBytePtr(data) else { return nil }
  let layout = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)

  let modifierSets: [(UInt32, CGEventFlags)] = [
    (0, []),
    (UInt32(shiftKey >> 8), .maskShift),
    (UInt32(optionKey >> 8), .maskAlternate),
    (UInt32((shiftKey | optionKey) >> 8), [.maskShift, .maskAlternate]),
  ]

  var deadKeyState: UInt32 = 0
  var chars = [UniChar](repeating: 0, count: 4)
  var length = 0

  for code in UInt16(0)..<128 {
    for (modifiers, chord) in modifierSets {
      deadKeyState = 0
      length = 0
      let status = UCKeyTranslate(
        layout,
        code,
        UInt16(kUCKeyActionDisplay),
        modifiers,
        UInt32(LMGetKbdType()),
        OptionBits(kUCKeyTranslateNoDeadKeysBit),
        &deadKeyState,
        chars.count,
        &length,
        &chars
      )
      if status == noErr && length == 1 && chars[0] == target {
        return (CGKeyCode(code), chord)
      }
    }
  }
  return nil
}

func postChord(_ code: CGKeyCode, _ extra: CGEventFlags) {
  if dryRun {
    log("DRY chord \(code)")
    return
  }
  // Mission Control and other system shortcuts are more reliable when the
  // modifier has a real down/up event, not just a flag attached to an arrow.
  let modifiers: [(CGEventFlags, CGKeyCode)] = [
    (.maskControl, 59),
    (.maskAlternate, 58),
    (.maskShift, 56),
    (.maskCommand, 55),
  ]
  var active: CGEventFlags = []
  for (flag, modifierCode) in modifiers where extra.contains(flag) {
    active.insert(flag)
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: modifierCode, keyDown: true) else { return }
    event.flags = active
    event.post(tap: .cghidEventTap)
  }
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return }
    event.flags = extra
    event.post(tap: .cghidEventTap)
  }
  for (flag, modifierCode) in modifiers.reversed() where extra.contains(flag) {
    active.remove(flag)
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: modifierCode, keyDown: false) else { return }
    event.flags = active
    event.post(tap: .cghidEventTap)
  }
}

func postUnicode(_ text: String) {
  let units = Array(text.utf16)
  guard !units.isEmpty else { return }
  units.withUnsafeBufferPointer { buffer in
    guard let address = buffer.baseAddress else { return }
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) else { return }
    down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: address)
    down.flags = []
    down.post(tap: .cgAnnotatedSessionEventTap)
    guard let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { return }
    up.flags = []
    up.post(tap: .cgAnnotatedSessionEventTap)
  }
}

func postText(_ text: String) {
  for character in text {
    if character == "\n" || character == "\r" {
      if dryRun { log("DRY char return"); continue }
      postKey(name: "return", down: true)
      postKey(name: "return", down: false)
      continue
    }
    if character == "\t" {
      if dryRun { log("DRY char tab"); continue }
      postKey(name: "tab", down: true)
      postKey(name: "tab", down: false)
      continue
    }
    if let stroke = layoutKey(for: character) {
      if dryRun {
        log("DRY char \(character) key \(stroke.code)")
        continue
      }
      postChord(stroke.code, stroke.flags)
      continue
    }
    if dryRun {
      log("DRY char \(character) unicode")
      continue
    }
    postUnicode(String(character))
  }
}

func applyFlags(_ object: [String: Any]) {
  flags = []
  if bool(object, "cmd") { flags.insert(.maskCommand) }
  if bool(object, "shift") { flags.insert(.maskShift) }
  if bool(object, "alt") { flags.insert(.maskAlternate) }
  if bool(object, "ctrl") { flags.insert(.maskControl) }
}

func handle(_ object: [String: Any]) {
  switch string(object, "op") {
  case "move":
    move(dx: number(object, "dx"), dy: number(object, "dy"))
  case "moveto":
    // Absolute pointer position in global display coordinates (used by the gyro pointer).
    let target = clampToDisplays(CGPoint(x: number(object, "x"), y: number(object, "y")))
    if let held = heldButton {
      place(target, type: dragType(held), button: held)
    } else {
      place(target, type: .mouseMoved, button: .left)
    }
  case "center":
    // Placed through the same path as moves so the tracked pointer stays in sync and
    // later gyro moves start from the middle of the screen instead of the old position.
    let bounds = CGDisplayBounds(CGMainDisplayID())
    place(CGPoint(x: bounds.midX, y: bounds.midY), type: .mouseMoved, button: .left)
  case "down":
    mouseDown(button(named: string(object, "button")))
  case "up":
    mouseUp(button(named: string(object, "button")))
  case "click":
    performClick(button(named: string(object, "button")), count: Int(number(object, "count")))
  case "scroll":
    scroll(dx: number(object, "dx"), dy: number(object, "dy"))
  case "key":
    let name = string(object, "name").lowercased()
    postKey(name: name, down: object["down"] == nil ? true : bool(object, "down"))
  case "chord":
    var extra: CGEventFlags = []
    if bool(object, "cmd") { extra.insert(.maskCommand) }
    if bool(object, "shift") { extra.insert(.maskShift) }
    if bool(object, "alt") { extra.insert(.maskAlternate) }
    if bool(object, "ctrl") { extra.insert(.maskControl) }
    guard let code = keyCodes[string(object, "name").lowercased()] else { break }
    if dryRun {
      log("DRY chord \(string(object, "name"))")
      break
    }
    postChord(code, extra)
  case "text":
    let text = string(object, "s")
    if !text.isEmpty && text.count <= 500 { postText(text) }
  case "flags":
    applyFlags(object)
  case "media":
    if string(object, "action") == "toggle" { postMediaToggle() }
  case "release":
    releaseHeld()
  default:
    break
  }
}

func accessibilityTrusted() -> Bool {
  if dryRun { return true }
  let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
  let options = [key: true] as CFDictionary
  return AXIsProcessTrustedWithOptions(options)
}

if CommandLine.arguments.contains("--self-test") {
  let trusted = accessibilityTrusted()
  let before = liveCursor()
  move(dx: 24, dy: 16)
  Thread.sleep(forTimeInterval: 0.05)
  let mid = liveCursor()
  move(dx: -24, dy: -16)
  Thread.sleep(forTimeInterval: 0.05)
  let after = liveCursor()
  let moved = hypot(mid.x - before.x, mid.y - before.y) > 8
  let restored = hypot(after.x - before.x, after.y - before.y) < 3
  log("self-test trusted=\(trusted) moved=\(moved) restored=\(restored) dx=\(mid.x - before.x) dy=\(mid.y - before.y)")
  exit(trusted && moved && restored ? 0 : 2)
}

let trusted = accessibilityTrusted()
log("READY trusted=\(trusted ? "1" : "0")")
if !trusted {
  log("Allow Remote Control (the app that started this, or your terminal app) in System Settings → Privacy & Security → Accessibility, then restart.")
  log(CommandLine.arguments[0])
}

while let line = readLine(strippingNewline: true) {
  guard let data = line.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data),
        let object = json as? [String: Any] else { continue }
  handle(object)
}

releaseHeld()
