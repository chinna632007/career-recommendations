/* =====================================================
   CONFIGURATION  —  reads settings from the .env file
   =====================================================
   The API key lives in the ".env" file in the project root
   (NOT in this file).

   1. Get a FREE API key from  https://openrouter.ai/keys
   2. Open the ".env" file next to index.html
   3. Paste the key after  OPENROUTER_API_KEY=
   4. Save and refresh the page.

   This script fetches ".env" when the page loads and fills
   in API_KEY / API_URL below. app.js waits for ENV_READY
   before it uses them.
   ===================================================== */

/* Free models that support JSON output, tried in order.
   If one is busy (429), rate-limited, or is a "reasoning" model that
   produces no JSON, the app automatically tries the next one.

   NOTE: the list below is only the FIRST attempt / backup. The app also
   asks OpenRouter which :free models are live right now and prepends them,
   so the order self-corrects over time. Verified working model is listed
   first so results appear as fast and reliably as possible. */
const MODELS = [
  "apodex/apodex-1.1-mini:free",
  "liquid/lfm-2.5-2.6b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "dots-studio/dots-3-note-preview:free"
];

/* Defaults — overwritten by the values found via env.js / .env. */
let API_KEY = "";
let API_URL = "https://openrouter.ai/api/v1/chat/completions";

/* Reads keys from either source (both end up in the same `vars` shape). */
function applyEnvVars(vars) {
  vars = vars || {};
  if (vars.OPENROUTER_API_KEY) API_KEY = String(vars.OPENROUTER_API_KEY).trim();
  if (vars.OPENROUTER_API_URL) API_URL = String(vars.OPENROUTER_API_URL).trim();
  if (!API_KEY) {
    console.warn("[config] OPENROUTER_API_KEY not found. Edit the .env file, run: node sync_env.js, then refresh.");
  }
}

/* Tiny .env parser: handles comments, blank lines and quoted values. */
function parseEnv(text) {
  const out = {};
  String(text == null ? "" : text).split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;   // blank or comment
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;                               // not KEY=VALUE
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
        (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  });
  return out;
}

/* Startup sequence:
   1. Pick up window.__ENV synchronously if js/env.js was loaded
      (env.js is auto-generated from .env so the browser can read it,
      because Live Server BLOCKS dotfiles and can never serve .env).
   2. ALSO try fetching .env directly (some servers allow dotfiles —
      if it works it refreshes the same values).
   ENV_READY resolves once both attempts are done — never rejects. */
const ENV_READY = (function () {
  // 1) Synchronous values from env.js (runs before config.js in the page).
  try {
    if (typeof window !== "undefined" && window.__ENV) {
      applyEnvVars(window.__ENV);
    }
  } catch (e) { /* ignore */ }

  // 2) Direct .env fetch as a refresh, where the server allows it.
  return fetch(".env", { cache: "no-store" })
    .then(function (res) { return (res && res.ok) ? res.text() : ""; })
    .then(function (text) {
      if (text) applyEnvVars(parseEnv(text));
      if (!API_KEY) {
        console.warn("[config] OPENROUTER_API_KEY missing. Edit .env, run: node sync_env.js, then refresh.");
      }
    })
    .catch(function (err) {
      // .env blocked (e.g. Live Server 404) is normal — env.js already applied.
      if (!API_KEY) {
        console.warn("[config] Could not read .env file:", err);
      }
    });
})();
