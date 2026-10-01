import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeToken(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function formatToken(value) {
  const token = normalizeToken(value);
  if (token.length !== 8) return token;
  return `${token.slice(0, 4)}-${token.slice(4)}`;
}

export function tokenFile(root) {
  return path.join(root, "agent", ".token");
}

export function loadToken(root) {
  if (process.env.AGENT_TOKEN) return normalizeToken(process.env.AGENT_TOKEN);
  const file = tokenFile(root);
  if (fs.existsSync(file)) return normalizeToken(fs.readFileSync(file, "utf8"));
  const bytes = crypto.randomBytes(8);
  let token = "";
  for (let i = 0; i < 8; i += 1) token += ALPHABET[bytes[i] % ALPHABET.length];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export function tokenMatches(input, expected) {
  const actual = Buffer.from(normalizeToken(input));
  const wanted = Buffer.from(normalizeToken(expected));
  if (actual.length === 0 || actual.length !== wanted.length) return false;
  return crypto.timingSafeEqual(actual, wanted);
}
