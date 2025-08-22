/* Pantry Planner — Copyright */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const pantryKey = "pp.pantry.v1";
const planKey = "pp.plan.v1";
const settingsKey = "pp.settings.v1";

let RECIPES = [];
let CATEGORIES = new Set();
let DEFERRED_INSTALL_PROMPT = null;
let CURRENT_DIALOG_RECIPE = null;
let WEEKPLAN = null;

/* ------------------- PWA install handling ------------------- */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  DEFERRED_INSTALL_PROMPT = e;
  $("#installBtn").style.display = "inline-block";
});
$("#installBtn").addEventListener("click", async () => {
  if (!DEFERRED_INSTALL_PROMPT) return;
  DEFERRED_INSTALL_PROMPT.prompt();
  await DEFERRED_INSTALL_PROMPT.userChoice;
  DEFERRED_INSTALL_PROMPT = null;
  $("#installBtn").style.display = "none";
});

/* ------------------- Load recipes ------------------- */
async function loadRecipes() {
  const res = await fetch("recipes.json");
  const data = await res.json();
  RECIPES = data;
  CATEGORIES = new Set(data.flatMap(r => r.category || []));
  // Fill category dropdown
  const sel = $("#category");
  for (const c of Array.from(CATEGORIES).sort()) {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  }
  renderResults();
}

/* ------------------- Pantry storage ------------------- */
function getPantry() {
  try { return JSON.parse(localStorage.getItem(pantryKey) || "[]"); }
  catch { return []; }
}
function setPantry(arr) {
  localStorage.setItem(pantryKey, JSON.stringify(arr));
  renderPantry();
  renderResults();
}
function addToPantry(name, qty="") {
  name = name.trim();
  if (!name) return;
  const p = getPantry();
  const existing = p.find(x => x.name === name);
  if (existing) existing.qty = qty || existing.qty;
  else p.push({name, qty});
  setPantry(p);
}
function removeFromPantry(name) {
  const p = getPantry().filter(x => x.name !== name);
  setPantry(p);
}
function clearPantry() { setPantry([]); }

function exportPantry() {
  const data = JSON.stringify(getPantry(), null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pantry.json";
  a.click();
}
function importPantry(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data)) setPantry(data);
      else alert("JSONの形式が違います");
    } catch(e){ alert("読み込みに失敗しました"); }
  };
  reader.readAsText(file);
}

/* ------------------- Week plan storage ------------------- */
const DAYS = ["月","火","水","木","金","土","日"];
function defaultPlan() {
  return DAYS.map(d => ({ day: d, items: [] }));
}
function getPlan() {
  try { return JSON.parse(localStorage.getItem(planKey) || "null") || defaultPlan(); }
  catch { return defaultPlan(); }
}
function setPlan(plan) {
  localStorage.setItem(planKey, JSON.stringify(plan));
  WEEKPLAN = plan;
  renderWeekPlan();
}

function exportPlan() {
  const data = JSON.stringify(getPlan(), null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "menu-plan.json";
  a.click();
}

/* ------------------- Matching logic ------------------- */
function normalize(s) {
  return s.toLowerCase().replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0)-0xFEE0))
           .replace(/[ー−―‐]/g, "-").trim();
}
function tokenizeIngredients(list) {
  return list.map(x => normalize(x));
}

function matchScore(recipe, pantryNames) {
  const req = tokenizeIngredients(recipe.ingredients);
  const have = new Set(pantryNames.map(normalize));
  let hit = 0;
  for (const ing of req) {
    // allow simple aliases
    const aliases = [ing];
    if (ing.includes("たまご") || ing.includes("卵")) aliases.push("卵","たまご","玉子");
    if (ing.includes("ねぎ")) aliases.push("長ねぎ","青ねぎ","ねぎ","ネギ");
    if (ing.includes("じゃがいも")) aliases.push("じゃがいも","ジャガイモ","男爵","メークイン","じゃが");
    if (ing.includes("にんじん")) aliases.push("にんじん","人参");
    if (ing.includes("玉ねぎ") || ing.includes("たまねぎ")) aliases.push("玉ねぎ","たまねぎ","オニオン","玉葱");
    if (ing.includes("ごはん")) aliases.push("ご飯","米","白米","ごはん");
    if (ing.includes("豚こま")) aliases.push("豚肉","豚こま切れ","豚こま");
    if (ing.includes("鶏もも")) aliases.push("鶏肉","鶏もも","とりもも");
    if (ing.includes("ひき肉")) aliases.push("合いびき肉","豚ひき肉","鶏ひき肉","牛ひき肉","ひき肉");
    if (ing.includes("しょうゆ")) aliases.push("醤油","しょうゆ","醤油");
    if (ing.includes("みりん")) aliases.push("みりん","本みりん");
    if (ing.includes("酒")) aliases.push("料理酒","酒");
    if (ing.includes("だし")) aliases.push("顆粒だし","和風だし","ほんだし","だし");
    if (ing.includes("味噌")) aliases.push("味噌","みそ");
    if (ing.includes("カレー")) aliases.push("カレールウ","カレー粉","カレー");
    if (ing.includes("片栗粉")) aliases.push("片栗粉","コーンスターチ");
    if (ing.includes("小麦粉")) aliases.push("小麦粉","薄力粉");
    if (ing.includes("マヨネーズ")) aliases.push("マヨ","マヨネーズ");
    if (ing.includes("ケチャップ")) aliases.push("トマトケチャップ","ケチャップ");
    const ok = aliases.some(a => have.has(normalize(a)));
    if (ok) hit++;
  }
  const pct = (hit / req.length) * 100;
  return { hit, need: req.length - hit, pct, missing: req.filter(ing => {
    const aliases = [ing];
    if (ing.includes("たまご") || ing.includes("卵")) aliases.push("卵","たまご","玉子");
    if (ing.includes("ねぎ")) aliases.push("長ねぎ","青ねぎ","ねぎ","ネギ");
    if (ing.includes("じゃがいも")) aliases.push("じゃがいも","ジャガイモ","男爵","メークイン","じゃが");
    if (ing.includes("にんじん")) aliases.push("にんじん","人参");
    if (ing.includes("玉ねぎ") || ing.includes("たまねぎ")) aliases.push("玉ねぎ","たまねぎ","オニオン","玉葱");
    if (ing.includes("ごはん")) aliases.push("ご飯","米","白米","ごはん");
    if (ing.includes("豚こま")) aliases.push("豚肉","豚こま切れ","豚こま");
    if (ing.includes("鶏もも")) aliases.push("鶏肉","鶏もも","とりもも");
    if (ing.includes("ひき肉")) aliases.push("合いびき肉","豚ひき肉","鶏ひき肉","牛ひき肉","ひき肉");
    if (ing.includes("しょうゆ")) aliases.push("醤油","しょうゆ","醤油");
    if (ing.includes("みりん")) aliases.push("みりん","本みりん");
    if (ing.includes("酒")) aliases.push("料理酒","酒");
    if (ing.includes("だし")) aliases.push("顆粒だし","和風だし","ほんだし","だし");
    if (ing.includes("味噌")) aliases.push("味噌","みそ");
    if (ing.includes("カレー")) aliases.push("カレールウ","カレー粉","カレー");
    if (ing.includes("片栗粉")) aliases.push("片栗粉","コーンスターチ");
    if (ing.includes("小麦粉")) aliases.push("小麦粉","薄力粉");
    if (ing.includes("マヨネーズ")) aliases.push("マヨ","マヨネーズ");
    if (ing.includes("ケチャップ")) aliases.push("トマトケチャップ","ケチャップ");
    return !aliases.some(a => have.has(normalize(a)));
  })};
}

/* ------------------- Render pantry ------------------- */
function renderPantry() {
  const chips = $("#pantryChips");
  chips.innerHTML = "";
  for (const item of getPantry()) {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `<span>${item.name}</span>${item.qty ? `<small>${item.qty}</small>`:""} <button title="削除" aria-label="削除">✕</button>`;
    el.querySelector("button").addEventListener("click", () => removeFromPantry(item.name));
    chips.appendChild(el);
  }
}

/* ------------------- Render results ------------------- */
function renderResults() {
  const container = $("#results");
  container.innerHTML = "<p style='opacity:.8'>候補を計算中…</p>";
  const pantryNames = getPantry().map(x => x.name);
  const matchMin = Number($("#matchPct").value);
  const maxTime = Number($("#maxTime").value);
  const category = $("#category").value;
  const q = normalize($("#searchInput").value);

  const cards = RECIPES
    .filter(r => (category ? r.category?.includes(category) : true))
    .filter(r => r.time <= maxTime || maxTime === 999)
    .filter(r => q ? (normalize(r.name).includes(q) || r.ingredients.some(i=>normalize(i).includes(q))) : true)
    .map(r => ({ r, m: matchScore(r, pantryNames) }))
    .filter(x => x.m.pct >= matchMin)
    .sort((a,b) => {
      // sort by: no missing first, higher pct, shorter time
      if (a.m.need !== b.m.need) return a.m.need - b.m.need;
      if (b.m.pct !== a.m.pct) return b.m.pct - a.m.pct;
      return a.r.time - b.r.time;
    });

  const onlyNoShop = $("#onlyNoShop").checked;
  const filtered = onlyNoShop ? cards.filter(x => x.m.need === 0) : cards;

  container.innerHTML = "";
  filtered.forEach(({r,m}) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${r.name}</h3>
      <div class="meta">
        <span>時間: ${r.time}分</span>
        <span>分類: ${r.category.join(" / ")}</span>
      </div>
      <div class="badges">
        ${m.need===0 ? `<span class="badge">買い物不要</span>` : `<span class="badge">不足 ${m.need}</span>`}
        <span class="badge">${Math.round(m.pct)}%一致</span>
      </div>
      <div class="progress-wrap"><div class="progress" style="width:${Math.max(4,Math.round(m.pct))}%"></div></div>
      <div style="font-size:13px; opacity:.9">材料: ${r.ingredients.join("、 ")}</div>
      <footer>
        <button class="openRecipe">詳しく</button>
        <button class="addPlan">献立に</button>
      </footer>
    `;
    card.querySelector(".openRecipe").addEventListener("click", () => openRecipeDialog(r, m));
    card.querySelector(".addPlan").addEventListener("click", () => openRecipeDialog(r, m, true));
    container.appendChild(card);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p style="opacity:.8">条件に合うレシピが見つからないかも。<br>一致率を下げるか、カテゴリや時間を見直してみて！</p>`;
  }
}

/* ------------------- Recipe dialog ------------------- */
function openRecipeDialog(recipe, match, addMode=false) {
  CURRENT_DIALOG_RECIPE = recipe;
  $("#dlgTitle").textContent = recipe.name;
  const missing = match.missing;
  const html = `
    <div class="meta"><span>時間: ${recipe.time}分</span><span>分類: ${recipe.category.join(" / ")}</span></div>
    <div><strong>材料</strong><br>${recipe.ingredients.map(i=>`・${i}`).join("<br>")}</div>
    ${recipe.optional?.length ? `<div><strong>あると良い</strong><br>${recipe.optional.map(i=>`・${i}`).join("<br>")}</div>` : ""}
    ${missing.length ? `<div><strong>不足しているもの</strong><br>${missing.map(i=>`・${i}`).join("<br>")}</div>` : `<div><strong>買い物不要</strong></div>`}
    ${recipe.steps?.length ? `<div><strong>作り方(簡易)</strong><br>${recipe.steps.map((s,i)=>`${i+1}. ${s}`).join("<br>")}</div>` : ""}
    ${recipe.tips ? `<div><strong>コツ</strong><br>${recipe.tips}</div>` : ""}
  `;
  $("#dlgContent").innerHTML = html;
  const dlg = $("#recipeDialog");
  dlg.showModal();
  $("#addToPlanBtn").onclick = () => addRecipeToPlan(recipe);
  if (addMode) $("#addToPlanBtn").click();
}

$("#dlgClose").addEventListener("click", ()=> $("#recipeDialog").close());
$("#dlgClose2").addEventListener("click", ()=> $("#recipeDialog").close());

/* ------------------- Week plan rendering ------------------- */
function renderWeekPlan() {
  const wrap = $("#weekPlan");
  wrap.innerHTML = "";
  WEEKPLAN.forEach((d, di) => {
    const cell = document.createElement("div");
    cell.className = "day-cell";
    cell.innerHTML = `<h4>${d.day}</h4><div class="slot"></div>`;
    const slot = cell.querySelector(".slot");
    d.items.forEach((it, ii) => {
      const s = document.createElement("div");
      s.className = "slot-item";
      s.innerHTML = `<span>${it}</span> <button title="削除">✕</button>`;
      s.querySelector("button").addEventListener("click", () => {
        WEEKPLAN[di].items.splice(ii,1);
        setPlan([...WEEKPLAN]);
      });
      slot.appendChild(s);
    });
    // Drop target
    cell.addEventListener("dragover", e => e.preventDefault());
    cell.addEventListener("drop", e => {
      const name = e.dataTransfer.getData("text/plain");
      WEEKPLAN[di].items.push(name);
      setPlan([...WEEKPLAN]);
    });
    wrap.appendChild(cell);
  });
}

function addRecipeToPlan(recipe) {
  // Find first day with < 3 items
  for (let i=0;i<WEEKPLAN.length;i++) {
    if ((WEEKPLAN[i].items?.length||0) < 3) {
      WEEKPLAN[i].items.push(recipe.name);
      setPlan([...WEEKPLAN]);
      $("#recipeDialog").close();
      return;
    }
  }
  alert("全ての枠が埋まっています。どこかを削除してね。");
}

/* ------------------- Events ------------------- */
$("#addBtn").addEventListener("click", () => {
  addToPantry($("#ingredientInput").value, $("#qtyInput").value);
  $("#ingredientInput").value = ""; $("#qtyInput").value = "";
  $("#ingredientInput").focus();
});
$("#ingredientInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addBtn").click();
});
$("#qtyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#addBtn").click();
});

$("#clearPantryBtn").addEventListener("click", clearPantry);
$("#exportPantryBtn").addEventListener("click", exportPantry);
$("#importPantryFile").addEventListener("change", e => {
  if (e.target.files?.[0]) importPantry(e.target.files[0]);
});

$("#matchPct").addEventListener("input", () => {
  $("#matchPctLabel").textContent = $("#matchPct").value + "%";
  renderResults();
});
$("#maxTime").addEventListener("change", renderResults);
$("#category").addEventListener("change", renderResults);
$("#onlyNoShop").addEventListener("change", renderResults);
$("#searchInput").addEventListener("input", renderResults);
$("#searchClearBtn").addEventListener("click", ()=> { $("#searchInput").value=""; renderResults(); });

$("#exportPlanBtn").addEventListener("click", exportPlan);
$("#clearPlanBtn").addEventListener("click", () => setPlan(defaultPlan()));

/* ------------------- Init ------------------- */
window.addEventListener("load", async () => {
  renderPantry();
  WEEKPLAN = getPlan();
  renderWeekPlan();
  await loadRecipes();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('service-worker.js'); }
    catch (e) { console.warn('SW failed', e); }
  }
});