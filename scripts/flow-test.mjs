import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* ---------- VIPER NUTRI: private manual entries; no XP granted ---------- */');
const end = html.indexOf('function renderMeals(){', start);
assert.ok(start >= 0 && end > start, 'Nutrition module should remain available to the app');

function testContext() {
  const nodes = new Map();
  const messages = [];
  const writes = [];
  const fields = {
    'vn-food-name': 'Arroz con pollo',
    'vn-food-calories': '520',
    'vn-food-protein': '28',
    'vn-food-carbs': '66',
    'vn-food-fat': '12',
    'vn-target-calories': '2200',
    'vn-target-protein': '140',
    'vn-target-carbs': '250',
    'vn-target-fat': '65'
  };
  const $ = id => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        value: fields[id] ?? '',
        disabled: false, innerHTML: '', textContent: '',
        reset() { this.resetCalled = true; }
      });
    }
    return nodes.get(id);
  };
  let dbError = null;
  const sb = { from(table) {
    return {
      async insert(row) { writes.push({ table, operation: 'insert', row }); return { error: dbError }; },
      async upsert(row, options) { writes.push({ table, operation: 'upsert', row, options }); return { error: dbError }; }
    };
  } };
  const context = {
    user: { id: 'test-user' },
    T: { hoy: '2026-11-24', mealEntries: [] },
    sb, $, document: { activeElement: null },
    toast: (message, danger = false) => messages.push({ message, danger }),
    errMsg: error => error.message,
    console
  };
  new Script(html.slice(start, end), { filename: 'viper-nutrition.js' }).runInNewContext(context);
  // Isolate backend effects: these checks never contact a real account or database.
  context.vnRender = () => {};
  context.vnLoad = async () => {};
  return {
    context, $, messages, writes,
    setDatabaseError(error) { dbError = error; }
  };
}

const event = () => ({
  submitter: { disabled: false },
  preventDefault() { this.prevented = true; }
});

// Food: invalid values never reach the backend.
{
  const t = testContext();
  t.$('vn-food-name').value = 'X';
  const e = event();
  await t.context.vnSaveFood(e);
  assert.equal(e.prevented, true);
  assert.equal(t.writes.length, 0);
  assert.equal(t.messages.at(-1).danger, true);

  t.$('vn-food-name').value = 'Arroz con pollo';
  t.$('vn-food-calories').value = '-1';
  await t.context.vnSaveFood(event());
  assert.equal(t.writes.length, 0);
}

// Food: one valid entry, for this account and this day, with no XP write.
{
  const t = testContext();
  const e = event();
  await t.context.vnSaveFood(e);
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].table, 'viper_manual_foods');
  assert.equal(t.writes[0].operation, 'insert');
  assert.equal(t.writes[0].row.user_id, 'test-user');
  assert.equal(t.writes[0].row.meal_date, '2026-11-24');
  assert.equal(t.writes[0].row.calories, 520);
  assert.equal(t.writes[0].row.protein_g, 28);
  assert.ok(!('xp' in t.writes[0].row));
  assert.equal(t.$('vn-food-form').resetCalled, true);
  assert.equal(e.submitter.disabled, false);
  assert.equal(t.messages.at(-1).danger, false);
}

// Food: server errors must not reset the form and must unlock the submit button.
{
  const t = testContext();
  t.setDatabaseError(new Error('temporary database outage'));
  const e = event();
  await t.context.vnSaveFood(e);
  assert.equal(t.writes.length, 1);
  assert.notEqual(t.$('vn-food-form').resetCalled, true);
  assert.equal(e.submitter.disabled, false);
  assert.equal(t.messages.at(-1).danger, true);
}

// Nutrition targets: validate minimum/maximum before upsert.
{
  const t = testContext();
  t.$('vn-target-calories').value = '500';
  await t.context.vnSaveGoals(event());
  assert.equal(t.writes.length, 0);
  t.$('vn-target-calories').value = '2200';
  const e = event();
  await t.context.vnSaveGoals(e);
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].table, 'viper_nutrition_targets');
  assert.equal(t.writes[0].row.user_id, 'test-user');
  assert.equal(t.writes[0].row.calories_target, 2200);
  assert.equal(t.writes[0].options.onConflict, 'user_id');
  assert.equal(e.submitter.disabled, false);
}

// Authenticated-only UI entry points, including a public fallback for sign-in.
// These are static guards, not live browser/authentication tests.
for (const id of ['auth-form', 'signup-profile-fields', 'signup-simple-note', 'salir', 'chat-panel', 'vn-food-form', 'vn-goals-form']) {
  assert.equal(html.split('id="' + id + '"').length - 1, 1, 'Missing or duplicate UI id: ' + id);
}
assert.ok(html.includes("sb.auth."), 'Authentication client is required');

console.log('VIPER flow tests passed: nutrition inputs, writes, errors, targets and UI guards.');
