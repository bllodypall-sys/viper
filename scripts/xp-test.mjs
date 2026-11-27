import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('function mealsN(){');
const end=html.indexOf('function fotoHTML(){',begin);
assert.ok(begin>=0&&end>begin,'Nutrition XP calculation must exist');
const script=html.slice(begin,end);
const context={T:{mealEntries:[],rachaAyer:0,saved:null,fotoPath:null,blob:null,prot:false}};
new Script(script,{filename:'viper-nutrition-xp-logic.js'}).runInNewContext(context);

function scenario(meals,options={}){
  const data=meals.map(([source,status])=>({source,status}));
  context.T={mealEntries:data,rachaAyer:options.streak||0,saved:options.saved??null,
    fotoPath:options.photo||null,blob:options.blob||null,prot:!!options.protein};
  return {meals:context.mealsN(),xp:context.previewXP(),dirty:context.dirty()};
}

// Manual and legacy food, pending/rejected AI photos: no XP.
let s=scenario([['manual','approved'],['legacy','approved'],['ai','pending'],['ai','rejected']]);
assert.equal(s.meals,0);
assert.equal(s.xp.xp,0);

// An approved meal yields exactly 10 points, only once per entry.
s=scenario([['ai','approved']]);
assert.equal(s.meals,1);
assert.equal(s.xp.xp,10);
s=scenario([['ai','approved'],['ai','approved'],['ai','pending']]);
assert.equal(s.meals,2);
assert.equal(s.xp.xp,20);

// Approved protein yields 15, never counted per click or per render.
s=scenario([], {protein:true});
assert.equal(s.xp.xp,15);
assert.equal(context.previewXP().xp,15);
s=scenario([['ai','approved']],{protein:true});
assert.equal(s.xp.xp,25);

// Gym photo: 50 base + 5/streak, capped at 10 consecutive days.
s=scenario([],{photo:'user/day.jpg',streak:0});
assert.equal(s.xp.xp,55);
s=scenario([],{photo:'user/day.jpg',streak:9});
assert.equal(s.xp.xp,100);
s=scenario([],{photo:'user/day.jpg',streak:15});
assert.equal(s.xp.xp,100);
s=scenario([['ai','approved']],{photo:'user/day.jpg',streak:9,protein:true});
assert.equal(s.xp.xp,125);

// Once server totals match approved foods and protein, there is no dirty day.
s=scenario([['ai','approved']],{protein:true,saved:{comidas:1,proteina:true}});
assert.equal(s.dirty,false);
assert.equal(context.previewXP().xp,25);
s=scenario([['ai','approved']],{protein:true,saved:{comidas:0,proteina:false}});
assert.equal(s.dirty,true);

// Server remains authoritative: client preview does not mutate stored XP.
assert.ok(html.includes("sb.rpc('registrar_dia'"));
assert.ok(!/sb\.from\(['"]checkins['"]\)\s*\.(?:insert|update|upsert|delete)\(/.test(html));
assert.ok(!/sb\.from\(['"]profiles['"]\)\s*\.update\(\s*\{\s*xp_total/.test(html));
console.log('VIPER nutrition XP scenarios passed: manual, pending, approved, protein, streak, cap, dirty and no client XP writes.');


/* Regression: two concurrent save requests must produce only one check-in RPC. */
{
  const saveStart=html.indexOf('var VIPER_DAY_SAVING = false;');
  const saveEnd=html.indexOf('/* ---------- Ranking ---------- */',saveStart);
  assert.ok(saveStart>0&&saveEnd>saveStart, 'Daily submission guard required');
  assert.ok(html.includes('g.disabled = !d || VIPER_DAY_SAVING;'), 'While saving, UI must keep its button disabled');
  assert.ok(html.includes("g.textContent = VIPER_DAY_SAVING ? 'Guardando…' : 'Guardar día';"));

  const nodes=new Map();
  const getNode=id=>{
    if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',hidden:false});
    return nodes.get(id);
  };
  let releaseRpc, calls=0;
  const pending=new Promise(resolve=>{releaseRpc=resolve;});
  const run={
    T:{mealEntries:[{source:'ai',status:'approved'}],rachaAyer:0,saved:null,blob:null,blobUrl:null,prot:false,fotoPath:null,hoy:'2026-11-26'},
    P:{xp_total:0},user:{id:'test-user'},$ : getNode,
    sb:{rpc:async()=>{calls++;await pending;return {error:null};}},
    idxOf:()=>0, LV:[{label:'Novato'}],
    toast:()=>{},renderHoy:()=>{},renderAll:()=>{},signPhoto:async()=>{},
    loadProfile:async()=>{run.P.xp_total=10;},
    loadToday:async()=>{run.T.saved={comidas:1,proteina:false,xp:10};},
    console, URL:{revokeObjectURL:()=>{}}
  };
  new Script(script+'\n'+html.slice(saveStart,saveEnd),{filename:'viper-guarded-save.js'}).runInNewContext(run);
  const first=run.guardar();
  const second=run.guardar();
  assert.equal(calls,1,'A concurrent second click must not submit another RPC');
  assert.equal(run.VIPER_DAY_SAVING,true,'Guard remains active until save finishes');
  releaseRpc();
  await Promise.all([first,second]);
  assert.equal(run.VIPER_DAY_SAVING,false,'Guard must always reset');
  await run.guardar();
  assert.equal(calls,1,'No repeat save when today is already synchronized');
}

assert.ok(html.includes('Crea una contraseña nueva de al menos 12 caracteres.'),'Password help must match current policy');
