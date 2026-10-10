#!/usr/bin/env node
/* ==========================================================
   sync_env.js  —  copies values from ".env" into "js/env.js"
   ==========================================================
   Why: Live Server BLOCKS dotfiles, so the browser can never
   fetch ".env" directly (HTTP 404). The browser CAN load the
   plain file "js/env.js", so this script mirrors the .env
   values into it.

   Usage:
     1. Edit the ".env" file in the project root.
     2. From this folder run:   node sync_env.js
     3. Refresh the page in the browser.
   ========================================================== */
var fs = require("fs");
var path = require("path");

var ROOT = __dirname;
var ENV_PATH = path.join(ROOT, ".env");
var OUT_PATH = path.join(ROOT, "js", "env.js");

function parseEnv(text) {
  var out = {};
  String(text == null ? "" : text).split(/\r?\n/).forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    var eq = trimmed.indexOf("=");
    if (eq === -1) return;
    var key = trimmed.slice(0, eq).trim();
    var val = trimmed.slice(eq + 1).trim();
    var first = val.charAt(0), last = val.charAt(val.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  });
  return out;
}

if (!fs.existsSync(ENV_PATH)) {
  console.error("ERROR: .env file not found at " + ENV_PATH);
  process.exit(1);
}

var vars = parseEnv(fs.readFileSync(ENV_PATH, "utf8"));

if (!vars.OPENROUTER_API_KEY) {
  console.error("ERROR: OPENROUTER_API_KEY is missing in the .env file.");
  process.exit(1);
}

var lines = [];
lines.push("/* ==========================================================");
lines.push("   AUTO-GENERATED from the \".env\" file — do NOT edit by hand.");
lines.push("   Edit \".env\" in the project root instead, then run:");
lines.push("       node sync_env.js");
lines.push("   ========================================================== */");
lines.push("window.__ENV = {");
lines.push('  "OPENROUTER_API_KEY": ' + JSON.stringify(vars.OPENROUTER_API_KEY) + ",");
lines.push('  "OPENROUTER_API_URL": ' + JSON.stringify(vars.OPENROUTER_API_URL || "https://openrouter.ai/api/v1/chat/completions"));
lines.push("};");
lines.push("");

fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
console.log("OK: wrote " + OUT_PATH);
console.log("Key starts with: " + String(vars.OPENROUTER_API_KEY).slice(0, 12) + "...");
