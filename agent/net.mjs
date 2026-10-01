import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const TAILSCALE_BINS = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "tailscale",
];

function run(bin, args) {
  try {
    return execFileSync(bin, args, {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function tailscaleBin() {
  for (const bin of TAILSCALE_BINS) {
    if (bin !== "tailscale" && !fs.existsSync(bin)) continue;
    return bin;
  }
  return "";
}

export function tailscaleIPv4s() {
  const bin = tailscaleBin();
  if (bin) {
    const out = run(bin, ["ip", "-4"]);
    const ips = out.split(/\s+/).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
    if (ips.length) return ips;
  }

  const found = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      const [a, b] = addr.address.split(".").map(Number);
      if (a === 100 && b >= 64 && b <= 127) found.push(addr.address);
    }
  }
  return found;
}

export function tailscaleDnsName() {
  const bin = tailscaleBin();
  if (!bin) return "";
  const out = run(bin, ["status", "--json"]);
  if (!out) return "";
  try {
    const name = String(JSON.parse(out)?.Self?.DNSName ?? "").replace(/\.$/, "");
    return name;
  } catch {
    return "";
  }
}

export function pageOrigins(port) {
  const origins = [];
  for (const ip of tailscaleIPv4s()) origins.push(`http://${ip}:${port}`);
  const dns = tailscaleDnsName();
  if (dns) origins.push(`http://${dns}:${port}`);
  return origins;
}
