import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/20261123090000_protect_xp_from_client_writes.sql", import.meta.url), "utf8");
const deletion = readFileSync(new URL("../supabase/functions/delete-account/index.ts", import.meta.url), "utf8");
const engagement = readFileSync(new URL("../supabase/migrations/20261123183000_viper_ai_community_and_security.sql", import.meta.url), "utf8");
const dmSql = readFileSync(new URL("../supabase/migrations/20261124011000_viper_direct_inbox_unread.sql", import.meta.url), "utf8");
const nutritionSql = readFileSync(new URL("../supabase/migrations/20261124033000_viper_train_nutri.sql", import.meta.url), "utf8");
const qualitySql = readFileSync(new URL("../supabase/migrations/20261124050000_viper_quality_atomic_saves.sql", import.meta.url), "utf8");
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
  "vip-challenge-list", "vip-challenge-week", "vip-ranking-link", "vip-badges-list",
  "vip-daily-counter", "vip-daily-title", "vip-daily-subtitle", "vip-daily-progress",
  "vip-daily-fill", "vip-daily-gym", "vip-daily-food", "vip-daily-gym-desc",
  "vip-daily-food-desc", "vip-daily-cta", "vip-daily-plan", "vip-badges-count",
  "vip-badges-next", "vip-badges-share", "landing-share",
  "logo-home", "current-section", "friend-dm-list", "chat-panel",
  "chat-title", "chat-subtitle", "chat-peer-avatar", "chat-peer-profile",
  "chat-options", "chat-options-menu", "chat-gallery", "chat-gallery-back",
  "chat-gallery-grid", "chat-view", "chat-messages", "chat-image", "chat-close",
  "friend-dm-search", "friend-dm-total", "nav-friend-unread", "inbox-head-button", "inbox-head-count",
  "vt-live-form", "vt-date", "vt-notes", "vt-add-name", "vt-add-muscle", "vt-report-share", "vt-draft-banner", "vt-draft-status", "vt-discard-draft",
  "vsg-start", "vsg-start-button", "vsg-start-preview", "vsg-config-toggle", "vsg-open-current", "vsg-config", "vsg-goal", "vsg-experience", "vsg-days", "vsg-type", "vsg-country", "vsg-age", "vsg-focus-open", "vsg-focus", "vsg-focus-title", "vsg-focus-content", "vsg-focus-count", "vsg-focus-volume", "vsg-focus-clock", "vsg-prev", "vsg-next", "vsg-save", "vsg-focus-close",
  "vt-add-exercise", "vt-repeat-last", "vt-live-list", "vt-timer-display",
  "vt-stop-rest", "vt-live-summary", "vt-save", "vt-report-week", "vt-report-summary",
  "vt-ai-edit", "vt-ai-copy", "vt-ai-editor", "vt-ai-textarea", "vt-ai-save", "vt-ai-cancel",
  "vn-goals-form", "vn-progress", "vn-target-calories", "vn-target-protein",
  "vn-target-carbs", "vn-target-fat", "vn-food-form", "vn-food-name",
  "vn-food-calories", "vn-food-protein", "vn-food-carbs", "vn-food-fat", "vn-manual-list"
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

assert.ok(html.includes('<meta property="og:image"'), "Share preview image missing");
assert.ok(html.includes('<link rel="canonical"'), "Canonical URL missing");
assert.ok(html.includes("function renderVipDaily()"), "Daily dashboard code missing");
assert.ok(html.includes("function vipBadgeDefinitions()"), "Badge catalog missing");
// Daily UX is driven by confirmed database checkins and approved food,
// never by optimistic, uncommitted XP previews.
assert.ok(html.includes("fmt(Number(T.saved && T.saved.xp)||0)"), "Today's displayed XP must be verified");
assert.ok(html.includes("Boolean(T.saved && T.saved.foto_path)"), "Daily gym progress must require a saved checkin");
const dailyStart = html.indexOf("function renderVipDaily(){");
const dailyEnd = html.indexOf("async function shareViper(", dailyStart);
assert.ok(dailyStart > 0 && dailyEnd > dailyStart);
const dailyCode = html.slice(dailyStart, dailyEnd);
const mockElements = {};
const mockElement = (id) => mockElements[id] ||= {
  textContent: "", style: {}, dataset: {}, classList: { toggle() {} },
  setAttribute(key, value) { this[key] = value; },
  querySelector() {return { textContent: "" }; }
};
const dailyContext = {
  T: { saved: null }, P: {xp_total: 0}, mealsN: () => 0,
  $: mockElement
};
new Script(dailyCode).runInNewContext(dailyContext);
dailyContext.renderVipDaily();
assert.equal(mockElement("vip-daily-progress")["aria-valuenow"], "0");
assert.equal(mockElement("vip-daily-cta").dataset.vipDailyDestination, "hoy");
dailyContext.T.saved = {foto_path: "test/gym.jpg", xp: 50};
dailyContext.mealsN = () => 1;
dailyContext.renderVipDaily();
assert.equal(mockElement("vip-daily-progress")["aria-valuenow"], "2");
assert.equal(mockElement("vip-daily-cta").dataset.vipDailyDestination, "feed");
const badgeStart = html.indexOf("function vipBadgeDefinitions(){");
const badgeEnd = html.indexOf("function renderVipDaily(){", badgeStart);
assert.ok(badgeStart>0 && badgeEnd>badgeStart);
const badgeContext = { P: {xp_total: 125, racha: 0}, $, fmt: String, esc: String };
function $(id) { return mockElement(id); }
new Script(html.slice(badgeStart, badgeEnd)).runInNewContext(badgeContext);
assert.equal(badgeContext.vipBadgeDefinitions().length, 12, "Expect 12 badges");
badgeContext.renderVipBadges();
assert.match(mockElement("vip-badges-count").textContent, /1 de 12/);


for (const option of ["profile", "gallery", "report", "block"])
  assert.equal(count('data-chat-option="' + option + '"'), 1, "Missing chat option: " + option);
assert.match(html, /id="chat-panel"[^>]*role="dialog"[^>]*aria-modal="true"/);
assert.ok(html.includes("id=\"logo-home\""), "VIPER logo home control missing");
assert.ok(html.includes("Estás en "), "Current section indicator missing");
assert.ok(html.includes("function renderChatGallery()"), "Chat gallery renderer missing");
assert.ok(html.includes("async function bloquearDesdeChat()"), "Block action missing");
assert.ok(html.includes("async function reportarDesdeChat()"), "Report action missing");
assert.ok(html.includes("async function loadChatPeerAvatar(id)"), "Friend avatar loader missing");
assert.ok(html.includes("sb.from('user_blocks').insert("), "Block action must use existing table");
assert.ok(html.includes("sb.from('content_reports').insert("), "Report action must use existing table");
assert.ok(html.includes("data-chat-user"), "Direct message contact buttons missing");
assert.ok(html.includes("createSignedUrl(m.media_path,3600)"), "Gallery media must use signed URLs");
assert.ok(html.includes(".chat-panel[hidden]"), "Hidden modal override must be present");
assert.match(html, /chatFriend\.id!==id\)return;/);

/* Ranking de amigos: un único botón cubre la tarjeta completa. */
const rankingStart=html.indexOf("function renderAmigos(){");
const rankingEnd=html.indexOf("/* ---------- VIPER Direct 2.0: inbox, unread and search ---------- */",rankingStart);
assert.ok(rankingStart>=0 && rankingEnd>rankingStart);
const renderSource=html.slice(rankingStart,rankingEnd);
assert.ok(renderSource.includes("class=\"friend-chat-row\" data-chat-user="));
assert.ok(!renderSource.includes('data-act="chat"'), "No separate Open Chat button");
assert.ok(!renderSource.includes('data-profile="' + "' + r.id + '"), "Name must not link to profile");
assert.ok(html.includes("#f-board .friend-chat-row{width:100%"),"Friend row must span full width");
const domNodes=Object.create(null);
const rankings={
  user:{id:"self"},
  F:[{id:"friendship-1",solicitante:"self",destinatario:"buddy",estado:"aceptada"}],
  U:{self:{id:"self",username:"Mi usuario",xp_total:285,racha_activa:4},buddy:{id:"buddy",username:"Mi amigo",xp_total:0,racha_activa:0}},
  LV:[{label:"Novato"}],
  idxOf:()=>0,fmt:String,esc:String,
  $:id=>domNodes[id]||=(id==="f-vacio"?{hidden:false}:{innerHTML:""}),
  sb:{storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:""}})})}},
  renderVipInbox:()=>{}
};
new Script(renderSource).runInNewContext(rankings);
rankings.renderAmigos();
assert.match(domNodes["f-board"].innerHTML, /<button[^>]*class="friend-chat-row"[^>]*data-chat-user="buddy"/);
assert.doesNotMatch(domNodes["f-board"].innerHTML, /data-profile=|Abrir chat<\/button>|data-chat-user="self"/);
assert.match(domNodes["f-board"].innerHTML, />Tú<\/span>/);
assert.match(domNodes["f-board"].innerHTML, />Mi amigo<\/b>/);


/* VIPER Direct 2.0: read states are private, previews are per accepted friend. */
assert.match(dmSql,/create table if not exists public\.viper_chat_reads/);
assert.match(dmSql,/alter table public\.viper_chat_reads enable row level security/);
assert.match(dmSql,/create policy viper_chat_reads_select_own/);
assert.match(dmSql,/create policy viper_chat_reads_insert_own/);
assert.match(dmSql,/create policy viper_chat_reads_update_own/);
assert.ok(dmSql.includes("security invoker"),"Inbox RPC must respect RLS");
assert.ok(dmSql.includes("revoke all on function public.viper_chat_inbox() from public, anon"),"No anonymous inbox access");
assert.ok(dmSql.includes("revoke all on function public.viper_mark_chat_read(uuid) from public, anon"),"No anonymous read-state writes");
assert.ok(dmSql.includes("m.sender_id=p_peer and m.recipient_id=v_me"),"Read state must only advance on incoming messages");
assert.ok(html.includes("async function markVipChatRead(peer)"),"Client must mark inbound messages read");
assert.ok(html.includes("inbox-head-button').addEventListener('click'"),"Header must link to Amigos");
assert.ok(html.includes("headerBadge.hidden=total===0"),"Unread updates must reach header");
assert.ok(html.includes("function subscribeVipInbox()"),"Chat should receive live updates");
assert.ok(html.includes("document.addEventListener('visibilitychange'"),"Inbox should refresh after background activity");
const inboxStart=html.indexOf("/* ---------- VIPER Direct 2.0: inbox, unread and search ---------- */");
const inboxEnd=html.indexOf("/* ---------- Perfil ---------- */",inboxStart);
assert.ok(inboxStart>0&&inboxEnd>inboxStart,"Inbox helper source missing");
const dmNodes=Object.create(null);
const dmGet=id=>dmNodes[id]||=(id==="friend-dm-search"?{value:""}:{innerHTML:"",textContent:"",hidden:false,setAttribute(key,value){this[key]=value;}});
const dmContext={
  user:{id:"self"},
  DM_INBOX:[
    {peer_id:"buddy",last_message_at:"2026-11-23T19:00:00Z",last_sender_id:"buddy",last_preview:"¡Vamos al gym!",unread_count:3},
    {peer_id:"other",last_message_at:"2026-11-22T19:00:00Z",last_sender_id:"self",last_preview:"Nos vemos",unread_count:0}
  ],
  F:[{solicitante:"self",destinatario:"buddy",estado:"aceptada"},{solicitante:"other",destinatario:"self",estado:"aceptada"}],
  U:{buddy:{id:"buddy",username:"Atleta Uno",avatar_path:null},other:{id:"other",username:"Otro Atleta",avatar_path:null}},
  $:dmGet,
  esc:(v)=>String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;"),
  sb:{storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:""}})})}},
  console
};
new Script(html.slice(inboxStart,inboxEnd)).runInNewContext(dmContext);
dmContext.renderVipInbox();
assert.match(dmGet("friend-dm-list").innerHTML,/data-chat-user="buddy"/);
assert.match(dmGet("friend-dm-list").innerHTML,/3 mensajes sin leer/);
assert.match(dmGet("friend-dm-list").innerHTML,/¡Vamos al gym!/);
assert.ok(dmGet("friend-dm-list").innerHTML.indexOf('data-chat-user="buddy"')<dmGet("friend-dm-list").innerHTML.indexOf('data-chat-user="other"'),"Newest conversation first");
dmGet("friend-dm-search").value="otro";
dmContext.renderVipInbox();
assert.doesNotMatch(dmGet("friend-dm-list").innerHTML,/data-chat-user="buddy"/);
assert.match(dmGet("friend-dm-list").innerHTML,/data-chat-user="other"/);
dmGet("friend-dm-search").value="";
dmContext.sb.rpc=async function(name){
  assert.equal(name,"viper_chat_inbox");
  return {data:dmContext.DM_INBOX,error:null};
};
await dmContext.refreshVipInbox();
assert.equal(dmGet("nav-friend-unread").textContent,"3");
assert.equal(dmGet("inbox-head-count").textContent,"3");
assert.equal(dmGet("nav-friend-unread").hidden,false);
dmContext.DM_INBOX=dmContext.DM_INBOX.map(m=>({...m,unread_count:0}));
await dmContext.refreshVipInbox();
assert.equal(dmGet("nav-friend-unread").hidden,true);
assert.equal(dmGet("inbox-head-count").hidden,true);


/* VIPER TRAIN/NUTRI regression and ownership checks */
assert.match(nutritionSql,/create table if not exists public\.viper_nutrition_targets/);
assert.match(nutritionSql,/create table if not exists public\.viper_manual_foods/);
assert.match(nutritionSql,/alter table public\.viper_manual_foods enable row level security/);
assert.match(nutritionSql,/alter table public\.viper_nutrition_targets enable row level security/);
assert.match(nutritionSql,/create policy viper_nutrition_targets_owner/);
assert.match(nutritionSql,/create policy viper_manual_foods_owner/);
assert.ok(nutritionSql.includes("using ((select auth.uid())=user_id)"));
assert.doesNotMatch(nutritionSql,/grant .* to anon/i);
assert.doesNotMatch(nutritionSql,/xp_total|registrar_dia/i);
assert.ok(html.includes("async function vtSaveLive(event)"));
assert.ok(html.includes("async function vtRepeatLast()"));
assert.ok(html.includes("function vtStartTimer(seconds)"));
assert.ok(html.includes("async function vtLoadWeeklyReport()"));
assert.ok(html.includes("async function vnSaveGoals(e)"));
assert.ok(html.includes("async function vnSaveFood(e)"));
assert.ok(html.includes("async function vnRemoveFood(id)"));
assert.ok(html.includes("function vnTotals()"));
assert.ok(html.includes("muscle_group:compatibleGroup"),"Legacy logger must use accepted muscle group");
assert.ok(html.includes("vt-ai-save').addEventListener"),"AI plans must be editable");
assert.ok(html.includes("VN_TARGETS=null;VN_MANUAL=[]"),"Nutrition state must be reset on sign out");

const trStart=html.indexOf("/* ---------- VIPER TRAIN: session recorder and recovery timer ---------- */");
const trEnd=html.indexOf("function evoAddSetRow(reps,weight){",trStart);
assert.ok(trStart>=0&&trEnd>trStart,"Training logic missing");
const trNodes={};
const trCtx={
  user:null,
  $:id=>trNodes[id]||=(id==="vt-live-list"?{innerHTML:""}:{textContent:""}),
  esc:String,fmt:String,toast:()=>{},console
};
new Script(html.slice(trStart,trEnd)).runInNewContext(trCtx);
assert.equal(trCtx.vtFormatTimer(90),"01:30");
assert.equal(trCtx.vtFormatTimer(0),"00:00");
trCtx.vtAddExercise("Sentadilla","cuadriceps",[{reps:8,weight_kg:70}]);
assert.match(trNodes["vt-live-list"].innerHTML,/Sentadilla/);
assert.equal(trCtx.vtValidateDraft(),true);
assert.match(trNodes["vt-live-summary"].textContent,/560 kg/);
trCtx.VT_LIVE[0].sets[0].reps=0;
assert.equal(trCtx.vtValidateDraft(),false,"Zero reps must be rejected");
trCtx.VT_LIVE[0].sets[0].reps=8;
trCtx.VT_LIVE[0].muscle="no_valido";
assert.equal(trCtx.vtValidateDraft(),false,"Unknown muscle must be rejected");

const nStart=html.indexOf("/* ---------- VIPER NUTRI: private manual entries; no XP granted ---------- */");
const nEnd=html.indexOf("function renderMeals(){",nStart);
assert.ok(nStart>=0&&nEnd>nStart);
const nCtx={
  T:{hoy:"2026-11-23",mealEntries:[
    {source:"ai",status:"approved",calories:400,protein_g:30,carbs_g:50,fat_g:10},
    {source:"ai",status:"rejected",calories:9999,protein_g:0,carbs_g:0,fat_g:0}
  ]},
  $:()=>({}),esc:String,toast:()=>{},console
};
new Script(html.slice(nStart,nEnd)).runInNewContext(nCtx);
nCtx.VN_MANUAL=[{calories:150,protein_g:5,carbs_g:20,fat_g:5}];
const macros=nCtx.vnTotals();
assert.equal(macros.calories,550,"Only approved AI meals and manual entries count toward nutrition totals");
assert.equal(macros.protein_g,35);
assert.equal(macros.carbs_g,70);
assert.equal(macros.fat_g,15);



/* Nutrition form behavior: no invalid data persisted; reload only after a successful save. */
const foodStart=html.indexOf("async function vnSaveFood(e){");
const foodEnd=html.indexOf("async function vnRemoveFood(id){",foodStart);
assert.ok(foodStart>0&&foodEnd>foodStart,"Manual food form handler missing");
const foodFields={
  "vn-food-name":{value:"",reset(){}},
  "vn-food-calories":{value:""},
  "vn-food-protein":{value:""},
  "vn-food-carbs":{value:""},
  "vn-food-fat":{value:""},
  "vn-food-form":{reset(){this.didReset=true;},didReset:false}
};
const foodCalls=[],foodToasts=[];
let shouldFailFood=false,foodReloads=0;
const foodCtx={
  user:{id:"test-user"},T:{hoy:"2026-11-24"},$:id=>foodFields[id],
  sb:{from:(table)=>{
    assert.equal(table,"viper_manual_foods");
    return {insert:async payload=>{
      foodCalls.push(payload);
      return shouldFailFood?{error:{message:"Fallo de red"}}:{error:null};
    }};
  }},
  vnLoad:async()=>{foodReloads++;},
  toast:(message,isError)=>foodToasts.push({message,isError}),
  errMsg:err=>err.message
};
new Script(html.slice(foodStart,foodEnd)).runInNewContext(foodCtx);
const foodSubmit=()=>({preventDefault(){},submitter:{disabled:false}});
foodFields["vn-food-name"].value="Arroz con pollo";
foodFields["vn-food-calories"].value="-1";
foodFields["vn-food-protein"].value="30";
foodFields["vn-food-carbs"].value="50";
foodFields["vn-food-fat"].value="12";
await foodCtx.vnSaveFood(foodSubmit());
assert.equal(foodCalls.length,0,"Invalid calories must not be saved");
foodFields["vn-food-calories"].value="550";
shouldFailFood=true;
await foodCtx.vnSaveFood(foodSubmit());
assert.equal(foodCalls.length,1);
assert.equal(foodReloads,0,"Failed save must not trigger reload");
assert.equal(foodFields["vn-food-form"].didReset,false,"Failed save must retain fields");
shouldFailFood=false;
await foodCtx.vnSaveFood(foodSubmit());
assert.equal(foodCalls.length,2);
assert.equal(foodCalls[1].user_id,"test-user");
assert.equal(foodCalls[1].meal_date,"2026-11-24");
assert.equal(foodCalls[1].calories,550);
assert.equal(foodReloads,1);
assert.equal(foodFields["vn-food-form"].didReset,true);
assert.ok(foodToasts.some(x=>String(x.message).includes("No se suman XP.")),"Manual food must not award XP");

/* VIPER integrated library and adaptive AI plan. */
assert.ok(html.includes('data-vt-add-library="'+ "'+esc(x[0])"),"Exercise library must offer direct add to live session");
assert.ok(html.includes("vtMacroFromAnatomy(add.dataset.vtMuscle)"),"Library muscle group must map to supported DB groups");
assert.ok(html.includes("function vtMacroFromAnatomy(muscle)"),"Macro group translator missing");
assert.ok(html.includes("async function vtRecentTrainingContext()"),"AI must consult recent sessions");
assert.ok(html.includes("history.slice(0,950)"),"AI context should be truncated");
assert.ok(html.includes("Actualizar plan con mi progreso"),"AI update action missing");
assert.ok(html.includes("VT_WEEKLY_STATS={sessions:"),"Shareable report must reflect saved records");
assert.ok(html.includes("shareViper('Mi semana en VIPER:"),"Weekly report share is user initiated");
trCtx.EVO_LEGACY_MUSCLES={pectoral_superior:['pecho','pectoral_mayor'],biceps_cabeza_larga:['biceps']};
assert.equal(trCtx.vtMacroFromAnatomy('pectoral_superior'),'pecho');
assert.equal(trCtx.vtMacroFromAnatomy('biceps_cabeza_larga'),'biceps');
assert.equal(trCtx.vtMacroFromAnatomy('aductores'),'cuadriceps');
const hStart=html.indexOf("async function vtRecentTrainingContext(){");
const hEnd=html.indexOf("async function generateVipAiPlan(){",hStart);
assert.ok(hStart>=0&&hEnd>hStart);
const mockHistory={
 user:{id:'self'},
 limaToday:()=> '2026-11-23',
 addDays:()=> '2026-10-27',
 sb:{from:(name)=>{
   assert.equal(name,'viper_workout_sessions');
   return {select:()=>({eq:()=>({gte:()=>({order:()=>({limit:async()=>({data:[],error:null})})})})})};
 }},
 console
};
new Script(html.slice(hStart,hEnd)).runInNewContext(mockHistory);
assert.match(await mockHistory.vtRecentTrainingContext(),/Sin sesiones registradas/);

/* Prevent accidental nesting of app functions inside eventos() again. */
const mainAppScript = scripts.find((body) => body.includes("function eventos(){") && body.includes("async function boot(){"));
assert.ok(mainAppScript,"Application boot script missing");
const scopeProbe = mainAppScript.replace(
  /boot\(\);\s*(?=if \('serviceWorker' in navigator\))/,
  "window.__viperScopeCheck__={"+
  ["vtLoadWeeklyReport","vtSaveLive","vtMacroFromAnatomy","vtAddExercise","cargarEvolucion","renderEvolucion","evoAddSetRow","guardarEvoEntrenamiento","consultarViperCoach","vtRecentTrainingContext","vnRender","vnSaveFood","vsgStarterTemplate","vsgRenderStart","vsgSaveProfile","vsgOpenFocus","vsgFinish"].map((k)=>JSON.stringify(k)+":typeof "+k).join(",")+
  "};\n"
);
assert.notEqual(scopeProbe,mainAppScript,"Runtime scope probe injection failed");
const scopeWindow = {__TEST__:false};
new Script(scopeProbe,{filename:"viper-runtime-scope.js"}).runInNewContext({window:scopeWindow,navigator:{},document:{},console});
assert.ok(scopeWindow.__viperScopeCheck__,"Runtime scope probe not executed");
for(const [name,kind] of Object.entries(scopeWindow.__viperScopeCheck__)){
  assert.equal(kind,"function",name+" must be available throughout the application, not nested inside eventos()");
}


/* VIPER QUALITY: database transactions, idempotency, RLS and draft recovery. */
assert.match(qualitySql,/add column if not exists client_request_id uuid/);
assert.match(qualitySql,/create unique index if not exists viper_workout_sessions_user_request_unique/);
assert.match(qualitySql,/create or replace function public\.viper_save_workout_v2/);
assert.match(qualitySql,/language plpgsql volatile security invoker/);
assert.match(qualitySql,/on conflict \(user_id,client_request_id\)/);
assert.match(qualitySql,/insert into public\.viper_workout_sets/);
assert.match(qualitySql,/insert into public\.viper_workout_sets/);
assert.match(qualitySql,/revoke all on function public\.viper_save_workout_v2\(uuid,date,text,jsonb\) from public,anon/);
assert.match(qualitySql,/grant execute on function public\.viper_save_workout_v2\(uuid,date,text,jsonb\) to authenticated/);
assert.match(qualitySql,/alter table public\.viper_client_errors enable row level security/);
assert.match(qualitySql,/create policy viper_client_errors_insert_own/);
assert.match(qualitySql,/grant insert on public\.viper_client_errors to authenticated/);
assert.doesNotMatch(qualitySql,/xp_total|registrar_dia/);
const saveBegin=html.indexOf("async function vtSaveLive(event){");
const saveEnd=html.indexOf("/* ---------- VIPER REPORT: verified weekly totals ---------- */",saveBegin);
assert.ok(saveBegin>=0&&saveEnd>saveBegin);
const saveCode=html.slice(saveBegin,saveEnd);
assert.ok(saveCode.includes("sb.rpc('viper_save_workout_v2'"),"Workout saves must use atomic RPC");
assert.doesNotMatch(saveCode,/sb\.from\('viper_workout_(sessions|exercises|sets)'\)/,"No manual partial inserts allowed");
assert.ok(saveCode.includes("VT_PENDING_SAVE=pending;"),"Pending request must survive lost responses");

const qualityBegin=html.indexOf("/* ---------- VIPER QUALITY: local, account-scoped draft recovery ---------- */");
const qualityEnd=html.indexOf("function vtAddExercise(name,muscle,sets){",qualityBegin);
assert.ok(qualityBegin>=0&&qualityEnd>qualityBegin);
const qualityElems=new Map();
function qNode(id){
  if(!qualityElems.has(id)){
    qualityElems.set(id,{
      value:id==='vt-date'?'2026-11-23':id==='vt-add-muscle'?'pecho':'',
      disabled:false,hidden:false,textContent:'',classList:{toggle(){}},
      querySelectorAll:()=>[]
    });
  }
  return qualityElems.get(id);
}
const stored=new Map(),draftUser={id:'user-1'};
const qc={
  user:draftUser,sb:{},VT_LIVE:[],VT_MUSCLES:['pecho','espalda','cuadriceps'],
  $:qNode,
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
  crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},
  window:{confirm:()=>true},
  limaToday:()=> '2026-11-23',
  vtRenderLive:()=>{},toast:()=>{},console
};
new Script(html.slice(qualityBegin,qualityEnd)).runInNewContext(qc);
qc.VT_LIVE=[{name:'Press',muscle:'pecho',sets:[{reps:8,weight_kg:60}]}];
qc.vtPersistDraft();
const draftKey=qc.vtDraftKey('user-1');
assert.ok(stored.has(draftKey),"Workout draft must be locally saved for this account");
assert.ok(!stored.has(qc.vtDraftKey('user-2')),"No draft may leak to another account");
qc.VT_LIVE=[];assert.equal(qc.vtRestoreDraft(),true);
assert.equal(qc.VT_LIVE[0].name,'Press');
assert.equal(qc.VT_LIVE[0].sets[0].weight_kg,60);
const snapshot=qc.vtDraftSnapshot();
const pendingId='22222222-2222-4222-8222-222222222222';
qc.VT_PENDING_SAVE={id:pendingId,payload:{date:snapshot.date,notes:snapshot.notes,exercises:snapshot.exercises}};
qc.vtPersistDraft();
qc.VT_LIVE=[];qc.VT_PENDING_SAVE=null;
assert.equal(qc.vtRestoreDraft(),true);
assert.equal(qc.VT_PENDING_SAVE.id,pendingId,"Pending request id must survive a reload");
qc.vtDropDraft('user-1');
assert.equal(stored.has(draftKey),false);

const saveCalls=[];
const saverCtx={
  user:{id:'u1'},VT_SAVING:false,VT_PENDING_SAVE:null,
  VT_LIVE:[{name:'Sentadilla',muscle:'cuadriceps',sets:[{reps:10,weight_kg:80}]}],
  $:id=>qNode(id),
  vtValidateDraft:()=>true,vtRequestId:()=>pendingId,
  vtDraftSnapshot:()=>({exercises:saverCtx.VT_LIVE.map(x=>({
    name:x.name,muscle:x.muscle,sets:x.sets.map(y=>({reps:y.reps,weight_kg:y.weight_kg}))
  }))}),
  vtPersistDraft:()=>{},vtDropDraft:()=>{},vtRenderLive:()=>{},vtStopTimer:()=>{},vtSetDraftUI:()=>{},
  vqReportError:()=>{},toast:()=>{},cargarEvolucion:async()=>{},console,
  sb:{
    rpc:async(name,args)=>{
      assert.equal(name,'viper_save_workout_v2');
      saveCalls.push(args);
      return saveCalls.length===1?{error:{name:'NetworkError'}}:
        {error:null,data:'33333333-3333-4333-8333-333333333333'};
    },
    from:()=>{throw new Error('Non-atomic insert attempt');}
  }
};
new Script(saveCode).runInNewContext(saverCtx);
await saverCtx.vtSaveLive({preventDefault(){}});
assert.equal(saverCtx.VT_PENDING_SAVE.id,pendingId);
assert.equal(saverCtx.VT_LIVE.length,1);
await saverCtx.vtSaveLive({preventDefault(){}});
assert.equal(saveCalls.length,2);
assert.equal(saveCalls[0].p_client_request_id,saveCalls[1].p_client_request_id);
assert.equal(JSON.stringify(saveCalls[0].p_exercises),JSON.stringify(saveCalls[1].p_exercises));
assert.equal(saverCtx.VT_LIVE.length,0);
assert.equal(saverCtx.VT_PENDING_SAVE,null);

/* VIPER START and mobile gym focus: real template behavior, no XP and accessibility */
assert.ok(html.includes('id="vsg-start"')&&html.includes('id="vsg-focus"'));
assert.ok(html.includes('aria-modal="true"'),"Focused gym must be a dialog");
assert.ok(html.includes("vsgRenderStart();")&&html.includes("if(!ATHLETE||!ATHLETE.goal)vsgOpenConfig(true);"),"First-run setup must show for missing profiles");
assert.ok(html.includes("if(VT_PENDING_SAVE){toast("),"Do not overwrite uncertain workout saves");
assert.ok(html.includes("vsgOpenFocus();"),"Starter CTA must lead into workout focus");
assert.ok(html.includes("vtRenderLive();vsgRenderFocus();"),"Focus mode must sync with the draft");
assert.ok(html.includes("$('vsg-focus').addEventListener('keydown'"),"Focus mode must handle keyboard navigation");
assert.ok(html.includes("vtSaveLive({preventDefault:function(){}})"),"Focused mode must use existing atomic workout save");
assert.ok(!html.includes("xp_total:p.experience"),"Starter templates cannot grant XP");

const startBegin=html.indexOf("/* ---------- VIPER START: a fast, editable first workout ---------- */");
const startEnd=html.indexOf("/* ---------- VIPER TRAIN: session recorder and recovery timer ---------- */",startBegin);
assert.ok(startBegin>=0&&startEnd>startBegin,"Starter implementation must be present outside handlers");
const stContext={console};
new Script(html.slice(startBegin,startEnd),{filename:"viper-start-logic.js"}).runInNewContext(stContext);
const novice=stContext.vsgStarterTemplate({goal:'general_fitness',experience:'beginner',training_days:3,training_type:'home'});
assert.equal(novice.length,3,"Beginner should have a short routine");
assert.equal(novice[0].sets.length,2,"Beginner routine should have fewer sets");
assert.ok(novice.every(x=>x.sets.every(y=>y.weight_kg===0)),"Starter routine must not invent weights");
const expert=stContext.vsgStarterTemplate({goal:'strength',experience:'over_2_years',training_days:5,training_type:'gym'});
assert.equal(expert.length,4,"Experienced users can start with four exercises");
assert.equal(expert[0].sets.length,3);
assert.equal(expert[0].sets[0].reps,6);
assert.ok(expert.every(x=>['pecho','espalda','hombros','biceps','triceps','antebrazos','abdomen','cuadriceps','isquiotibiales','gluteos','pantorrillas'].includes(x.muscle)));
const boxing=stContext.vsgStarterTemplate({goal:'boxing',training_type:'boxing',training_days:2});
assert.ok(boxing.every(x=>x.sets.every(y=>y.weight_kg===0)),"Boxing warm-up presets must be bodyweight");
assert.ok(html.includes("if(!VT_LIVE.length&&!VT_PENDING_SAVE){vsgCloseFocus(true);ir('evolucion');}"),"Close focus only after saved or confirmed");

console.log("VIPER smoke checks passed: START, focus mode, scope, atomic saves, draft recovery, nutrition and security.");

/* Shared invitation links must follow the active Vercel domain. */
assert.ok(html.includes("var url=window.location.origin+'/';"), "VIPER share URL must follow the current domain");
assert.ok(!html.includes("var url='https://viper-7n4z.vercel.app/';"), "Do not hardcode the old share URL");

/* New public domain: ensure social metadata and canonical URLs match. */
assert.ok(html.includes('<meta property="og:url" content="https://viperfitness.vercel.app/">'));
assert.ok(html.includes('<meta property="og:image" content="https://viperfitness.vercel.app/icon-512.png">'));
assert.ok(html.includes('<link rel="canonical" href="https://viperfitness.vercel.app/">'));
assert.ok(!html.includes('https://viper-7n4z.vercel.app/'), "Avoid stale public metadata and links");

/* A stale token must not lead to an anonymous meal data grant. */
const mealFixStart=html.indexOf('  var mealQuery = function(){');
const mealFixEnd=html.indexOf('  var mealRows = mr.data || [];',mealFixStart);
assert.ok(mealFixStart>0 && mealFixEnd>mealFixStart,"Private meal loader recovery missing");
const mealFix=html.slice(mealFixStart,mealFixEnd);
assert.ok(mealFix.includes("sb.auth.getSession()"));
assert.ok(mealFix.includes("sb.auth.refreshSession()"));
assert.ok(mealFix.includes("mr = await mealQuery()"));
assert.ok(mealFix.includes("mr.error.code === '42501'"));
assert.ok(!mealFix.includes("grant select"));

/* A failed startup must have an actionable retry without weakening permissions. */
requireId('app-start-error');
requireId('app-start-error-message');
requireId('app-retry');
assert.ok(html.includes("if (iniciado || !user) return;"),'Never load private data before session initialization');
assert.ok(html.includes("$('app-start-error').hidden = false;"),'Startup failures must be visible');
assert.ok(html.includes("$('app-retry').addEventListener('click'"),'Startup error retry must be wired');
assert.ok(html.includes("vqReportError('startup',e);"),'Startup failures must be categorized');

/* The installable build must include the SVG icon referenced by the manifest. */
const prepareSource=readFileSync(new URL('./prepare-web.mjs',import.meta.url),'utf8');
assert.ok(prepareSource.includes("'favicon.svg'"),"PWA build must include the favicon declared in the manifest");
