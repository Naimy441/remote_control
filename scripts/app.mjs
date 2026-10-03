import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installMenuApp } from "../agent/menu-app.mjs";

// Installs Remote Control as a Mac app and opens it. Opening the app starts RC in the background,
// so after this Terminal is no longer needed: open "Remote Control" from Spotlight instead.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = installMenuApp(root);
execFileSync("/usr/bin/open", [app]);
console.log(`Installed ${app}`);
console.log("Open Remote Control from Spotlight (⌘ Space) whenever you want it. It starts RC and shows the RC menu.");
