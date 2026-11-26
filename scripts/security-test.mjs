import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = load('../index.html');
const pkg = JSON.parse(load('../package.json'));
const manifest = JSON.parse(load('../manifest.webmanifest'));
const migration = load('../supabase/migrations/20261126173457_targeted_social_indexes_and_meal_policy.sql');
const count = (s) => html.split(s).length - 1;

// Authentication callbacks must return to the origin actually opened by the visitor.
assert.ok(html.includes("signInWithOAuth({provider: 'google', options: {redirectTo: location.origin + location.pathname + location.search}})"));
assert.ok(html.includes("resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname+location.search,captchaToken:captchaToken})"));
assert.ok(html.includes("emailRedirectTo: location.origin + location.pathname"));
assert.ok(html.includes('sb.auth.onAuthStateChange('));
assert.ok(html.includes("sb.auth.getSession()"));

// Never ship the service-role key or service secrets to the browser bundle.
assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]+/.test(html));
assert.ok(!/https:\/\/viper-7n4z\.vercel\.app/.test(html));
assert.equal(count('id="auth-form"'), 1);
assert.equal(count('id="app-start-error"'), 1);
assert.equal(count('id="app-retry"'), 1);

// The browser may SELECT private food records, but all writes to AI-approved
// meal entries must remain in the authenticated server-side Edge Function.
assert.ok(!/sb\.from\(['"]meal_entries['"]\)\s*\.(insert|upsert|update|delete)\s*\(/.test(html));
assert.ok(html.includes('sb.from(\'meal_entries\').select('));
assert.ok(html.includes("sb.auth.refreshSession()"));
assert.ok(html.includes("start().catch(function(e)"), 'Startup retry must preserve error handling');

// No privilege expansion in the database optimization.
assert.equal((migration.match(/create index if not exists/gi) || []).length, 5);
assert.ok(migration.includes('alter policy meal_entries_select_own on public.meal_entries'));
assert.ok(migration.includes('user_id = (select auth.uid())'));
assert.ok(!/\bGRANT\b|\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(migration));

// Mobile viewport and installable app files are part of the built bundle.
assert.ok(/<meta\s+name="viewport"/.test(html));
assert.ok(html.includes('id="mobile-tabs"'));
assert.ok(html.includes('id="vsg-focus"'));
const prepare = load('./prepare-web.mjs');
for (const asset of ['index.html','boxeo.html','privacidad.html','terminos.html','manifest.webmanifest','favicon.svg','icon-180.png','icon-192.png','icon-512.png']) {
  assert.ok(existsSync(new URL('../'+asset,import.meta.url)), 'Missing PWA asset: '+asset);
  assert.ok(prepare.includes("'"+asset+"'"),'Packager omits '+asset);
}
assert.ok(manifest.start_url === './' && manifest.scope === './');
assert.ok(manifest.icons.every(icon => existsSync(new URL('../'+icon.src.split('?')[0],import.meta.url))));
assert.ok(pkg.scripts['prepare:web']);

console.log('VIPER security QA passed: auth redirects, private meal writes, domain, RLS policy, mobile/PWA assets.');

/* Free-tier password hardening: applies only to registration and password changes. */
assert.ok(html.includes("$('auth-password').minLength = authMode === 'signup' ? 12 : 8;"));
assert.ok(html.includes("password.length < (authMode === 'signup' ? 12 : 8)"));
assert.ok(html.includes("if(password.length<12||password.length>72)"));
assert.ok(html.includes("if(password.length<12){$('login-msg').textContent="));
for (const id of ['recovery-password','recovery-password-confirm','security-new-password','security-confirm-password']) {
  assert.ok(new RegExp('id="'+id+'"[^>]*minlength="12"').test(html),'New password should be 12+ chars: '+id);
}
assert.ok(html.includes('id="auth-password" type="password" autocomplete="current-password" minlength="8"'), 'Existing account login must still support its original password length');
