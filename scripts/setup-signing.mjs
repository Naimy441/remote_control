// Creates a local self-signed code-signing certificate so the Mac helpers keep one stable
// identity across rebuilds. macOS then remembers Accessibility / Automation grants instead of
// asking again after every compile. Skip this if you already have an Apple Development
// certificate (Xcode → Settings → Accounts), which is picked up automatically.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LOCAL_IDENTITY = "RC Local Signing";
const keychain = path.join(os.homedir(), "Library/Keychains/login.keychain-db");

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function existing() {
  try {
    return run("security", ["find-identity", "-p", "codesigning"]).includes(`"${LOCAL_IDENTITY}"`);
  } catch {
    return false;
  }
}

if (process.platform !== "darwin") {
  console.error("This only applies to macOS.");
  process.exit(1);
}

if (existing()) {
  console.log(`"${LOCAL_IDENTITY}" is already in your keychain. Nothing to do.`);
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-sign-"));
try {
  const conf = path.join(dir, "cert.conf");
  fs.writeFileSync(
    conf,
    [
      "[req]",
      "distinguished_name = dn",
      "x509_extensions = ext",
      "prompt = no",
      "[dn]",
      `CN = ${LOCAL_IDENTITY}`,
      "[ext]",
      "basicConstraints = critical,CA:false",
      "keyUsage = critical,digitalSignature",
      "extendedKeyUsage = critical,codeSigning",
      "",
    ].join("\n"),
  );
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const p12 = path.join(dir, "identity.p12");
  const pass = "rc-local-signing";
  run("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650", "-keyout", key, "-out", cert, "-config", conf]);
  run("/usr/bin/openssl", ["pkcs12", "-export", "-inkey", key, "-in", cert, "-out", p12, "-passout", `pass:${pass}`]);

  console.log("Adding the certificate to your login keychain…");
  run("security", ["import", p12, "-k", keychain, "-P", pass, "-T", "/usr/bin/codesign"]);
  console.log("macOS will now ask for your password to trust it for code signing.");
  run("security", ["add-trusted-cert", "-r", "trustRoot", "-p", "codeSign", "-k", keychain, cert], { stdio: ["inherit", "pipe", "inherit"] });
  console.log(`Done. "${LOCAL_IDENTITY}" will be used the next time you run npm run mac.`);
  console.log("When Keychain asks whether codesign may use the key, choose Always Allow.");
} catch (error) {
  console.error(String(error?.stderr || error?.message || error));
  process.exitCode = 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
