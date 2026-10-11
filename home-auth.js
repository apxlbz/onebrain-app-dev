/* Sign-in and routing for the OneBrain home page. Extracted from index.html
 * (F8: inline scripts moved out so a strict Content-Security-Policy can
 * forbid inline script execution). The page is the front door for everyone:
 * a visitor reads it, a member signs in from the button top right. Someone
 * who already has a session is NOT bounced away — the buttons simply become
 * "Open OneBrain" — because a home page that vanishes the moment you are
 * logged in is a page nobody can ever show a colleague. The one exception is
 * the return leg of Google sign-in itself: that visit exists only to land you
 * in the product, so it routes onward (unfinished org -> setup, else
 * dashboard). */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FN, SUPA_ORIGIN } from "./env.js?v=1";

// Per-environment endpoints for the "Wire it up" snippets.
const MCP = `${SUPA_ORIGIN}/functions/v1/mcp`;
const API = `${SUPA_ORIGIN}/functions/v1/api`;
document.querySelectorAll("[data-mcp-url]").forEach((el) => { el.textContent = MCP; });
document.querySelectorAll("[data-api-url]").forEach((el) => { el.textContent = API; });
document.querySelectorAll("[data-copy]").forEach((el) => {
  el.dataset.copy = el.dataset.copy.replace(/__MCP_URL__/g, MCP).replace(/__API_URL__/g, API);
});

const returning = /access_token=|provider_token=/.test(location.hash);
const buttons = [...document.querySelectorAll("[data-signin]")];
const cfg = await fetch(`${FN}/api/config`).then((r) => r.json());
const sb = createClient(cfg.supabase_url, cfg.supabase_anon_key);

async function destination() {
  try {
    const { data: ob } = await sb.from("onboarding").select("completed_at").maybeSingle();
    return ob?.completed_at ? "./app.html" : "./onboard.html";
  } catch { return "./app.html"; }
}

function showSignedIn(dest) {
  for (const b of buttons) {
    b.setAttribute("href", dest);
    b.textContent = b.classList.contains("cta") ? "Open OneBrain" : "Open OneBrain";
    b.removeAttribute("data-signin");
  }
}

buttons.forEach((b) => b.addEventListener("click", async (e) => {
  if (!b.hasAttribute("data-signin")) return;     // already routed: a plain link
  e.preventDefault();
  b.setAttribute("aria-busy", "true");
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) { b.removeAttribute("aria-busy"); alert(error.message); }
}));

const { data: { session } } = await sb.auth.getSession();
if (session) {
  const dest = await destination();
  if (returning) { location.replace(dest); } else { showSignedIn(dest); }
} else if (returning) {
  // The hash is being consumed by supabase-js; route once the session lands.
  sb.auth.onAuthStateChange(async (_e, s) => { if (s) location.replace(await destination()); });
}
