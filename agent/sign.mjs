import { execFileSync } from "node:child_process";

// macOS ties Accessibility / Automation / folder grants to a code signature. An ad-hoc signature
// is different for every build, so each recompile asked for the permissions again. Signing with a
// real certificate and a fixed identifier keeps the same identity, so a grant sticks.
let identity;

export function signingIdentity() {
  if (identity !== undefined) return identity;
  identity = "";
  if (process.env.RC_SIGN_IDENTITY) {
    identity = process.env.RC_SIGN_IDENTITY;
    return identity;
  }
  try {
    const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const hash = out.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(?:Apple Development|Developer ID Application|Mac Developer)[^"]*"/m);
    if (hash) identity = hash[1];
  } catch {
    // No keychain access: fall back to an ad-hoc signature.
  }
  if (!identity) {
    // The self-signed certificate from `npm run setup-signing`.
    try {
      const all = execFileSync("security", ["find-identity", "-p", "codesigning"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const local = all.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"RC Local Signing"/m);
      if (local) identity = local[1];
    } catch {
      // Ignore.
    }
  }
  return identity;
}

/** Sign a binary or app bundle with a stable identifier; returns "certificate" or "ad-hoc". */
export function signBinary(target, identifier) {
  const id = signingIdentity();
  if (id) {
    try {
      execFileSync("codesign", ["-s", id, "-i", identifier, "--force", target], { stdio: "ignore" });
      return "certificate";
    } catch {
      // Fall through to ad-hoc (for example if the key is locked).
    }
  }
  try {
    execFileSync("codesign", ["-s", "-", "-i", identifier, "--force", target], { stdio: "ignore" });
  } catch {
    // An unsigned build still runs.
  }
  return "ad-hoc";
}

/** Re-sign an existing build that still has an ad-hoc signature, once a certificate is available. */
export function ensureSigned(target, identifier) {
  if (!signingIdentity()) return;
  let info = "";
  try {
    info = execFileSync("codesign", ["-dvv", target], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    info = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  }
  if (/Signature=adhoc/.test(info) || !info.includes(`Identifier=${identifier}`) || !/Authority=/.test(info)) {
    signBinary(target, identifier);
  }
}
