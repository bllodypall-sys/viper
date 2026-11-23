import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261123090000_protect_xp_from_client_writes.sql", import.meta.url), "utf8");
const deletion = readFileSync(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8");
const engagement = readFileSync(new URL("../supabase/migrations/20261123183000_viper_ai_community_and_security.sql", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).filter((body) => body.trim());
assert.ok(scripts.length >= 2, "Expected inline setup + application scripts");
for (const script of scripts) new Script(script, { filename: "index-inline.js" });

const count = (needle) => html.split(needle).length - 1;
const requireId = (id) => assert.equal(count('id="' + id + '"'), 1, "Missing or repeated ID " + id);
for (const id of [
  "mobile-tabs", "auth-form", "signup-profile-fields", "signup-simple-note",
  "security-delete-confirm", "security-delete-account", "security-delete-status",
  "nav-toggle", "sidebar",
  "landing-signup", "vip-ai-create", "vip-ai-text", "vip-ai-status",
  "vip-challenge-list", "vip-challenge-week", "vip-ranking-link", "vip-badges-list"
]) requireId(id);
for (const tab of ["inicio", "hoy", "feed", "evolucion", "perfil"])
  assert.equal(count('data-mobile-nav="' + tab + '"'), 1, "Missing tab " + tab);
assert.match(html, /sb\.functions\.invoke\('delete-account'/);
assert.match(html, /training_days: Number\(\$\('ob-days'\)\.value\) \|\| 3/);
assert.match(sql, /create trigger viper_guard_checkins/);
assert.match(sql, /create trigger viper_guard_profile_score/);
assert.match(sql, /revoke insert, update, delete on public\.checkins from authenticated/);
assert.match(deletion, /admin\.auth\.admin\.deleteUser\(data\.user\.id\)/);
assert.match(deletion, /await removeOwnedFiles\(admin, data\.user\.id\)/);
assert.doesNotMatch(deletion, /sb_secret_|sk_live_/);
assert.ok(html.includes("functions.invoke('viper-ai-coach'"), "Missing existing VIPER Coach call");
assert.ok(html.includes("async function generateVipAiPlan("));
assert.ok(html.includes("async function loadVipChallenges("));
assert.ok(html.includes("function renderVipBadges("));
assert.ok(engagement.includes("alter table public.viper_ai_training_plans enable row level security"));
assert.ok(engagement.includes("alter table public.viper_weekly_challenge_entries enable row level security"));
assert.match(engagement, /security_invoker = true/);
assert.ok(engagement.includes("revoke execute on function public.crear_perfil"));
assert.doesNotMatch(engagement, /grant.*to anon/i);
console.log("VIPER smoke checks passed: inline JS, navigation, security, AI plans, community challenges and deletion.");
