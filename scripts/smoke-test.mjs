import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261123090000_protect_xp_from_client_writes.sql", import.meta.url), "utf8");
const deletion = readFileSync(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).filter((body) => body.trim());
assert.ok(scripts.length >= 2, "Expected inline setup + application scripts");
for (const script of scripts) new Script(script, { filename: "index-inline.js" });

const count = (needle) => html.split(needle).length - 1;
const requireId = (id) => assert.equal(count('id="' + id + '"'), 1, "Missing or repeated ID " + id);
for (const id of [
  "mobile-tabs", "auth-form", "signup-profile-fields", "signup-simple-note",
  "security-delete-confirm", "security-delete-account", "security-delete-status",
  "nav-toggle", "sidebar"
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
console.log("VIPER smoke checks passed: inline JS, UI controls, navigation, XP and deletion.");
