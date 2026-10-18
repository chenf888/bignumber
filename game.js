/**
 * 超指数工厂 -- 一个用 bignumber.js 驱动的数值增量游戏。
 *
 * 能量始终表示为「产能 × 脉冲数」，所以不需要反复累加巨大的符号表达式。
 * 产能由高德纳箭头生成：0 个箭头是乘法，1 个是指数，2 个是四则超运算，
 * 依此类推，直到 7 个箭头。终极目标是让产能达到 10↑↑↑↑↑↑↑10。
 */

import {
  Incomparable,
  compare,
  mul,
  num,
  pow,
  sci,
  up,
} from "./bignumber.js";

const SAVE_KEY = "hypergrowth-save-v1";
const TICK_MS = 100;
const TICKS_PER_SECOND = 10;
const MAX_ARROWS = 7;
const MAX_LEVEL = 100;
const TARGET = up(num(10), MAX_ARROWS, num(10));

const $ = (id) => document.getElementById(id);

const state = {
  k: 0,
  height: 1,
  reactor: 0,
  ticks: 0n,
  cores: 0,
  coreFraction: 0,
  clicks: 0,
  autoBuy: false,
  won: false,
  log: [],
};

let suppressSave = false;

// ---------------------------------------------------------------------------
// Derived numbers
// ---------------------------------------------------------------------------

/** 当前每次脉冲产生的能量。 */
function rate() {
  const h = state.height + state.reactor;
  const base = state.k === 0
    ? mul(num(10), num(h))
    : up(num(10), state.k, num(h));
  return mul(base, pow(num(2), num(state.reactor)));
}

/** 当前总能量 = 产能 × 累计脉冲。 */
function energy() {
  return mul(rate(), num(state.ticks));
}

/** 每秒获得的核心数。核心只用于购买升级，因此保持普通整数。 */
function coreRate() {
  return 5 * 4 ** state.k + 2 * state.height + 2 * state.reactor;
}

function heightCost() {
  return Math.floor(10 * 1.8 ** state.height);
}

function reactorCost() {
  return Math.floor(8 * 1.7 ** state.reactor);
}

function arrowCost() {
  return Math.floor(50 * 3 ** state.k);
}

/** 跃迁到下一箭头维度所需的能量。 */
function arrowThreshold(k) {
  return k === 0 ? num(1000) : up(num(10), k, num(4));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatBig(x, prec = 4) {
  try {
    return sci(x, prec);
  } catch {
    return String(x);
  }
}

function formatRate() {
  const r = rate();
  if (r.op === "m") {
    return r.args.map((part) => formatBig(part, 4)).join(" × ");
  }
  return formatBig(r, 4);
}

function formatEnergy() {
  if (state.ticks === 0n) return "0";
  const r = rate();
  // 精确产能直接算总量；符号产能只展示「产能 × 脉冲」，避免每个 tick 都建新节点。
  if (r.op === "i") return formatBig(mul(r, num(state.ticks)), 4);
  return `${formatRate()} × ${state.ticks.toLocaleString("zh-CN")}`;
}

function formatInt(n) {
  if (!Number.isFinite(n)) return "∞";
  return Math.floor(n).toLocaleString("zh-CN");
}

function formatDuration(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${s} 秒`;
  return `${s} 秒`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function energyAtLeast(threshold) {
  try {
    return compare(energy(), threshold) >= 0;
  } catch (err) {
    if (err instanceof Incomparable) return false;
    throw err;
  }
}

function canBuyArrow() {
  return state.k < MAX_ARROWS
    && state.cores >= arrowCost()
    && energyAtLeast(arrowThreshold(state.k));
}

function checkVictory() {
  if (state.won) return;

  let reached = false;
  try {
    reached = compare(rate(), TARGET) >= 0;
  } catch (err) {
    if (!(err instanceof Incomparable)) throw err;
    reached = state.k >= MAX_ARROWS && state.height + state.reactor >= 10;
  }
  if (!reached) return;

  state.won = true;
  addLog("目标达成：产能越过 10↑↑↑↑↑↑↑10！");
  showVictory();
  save();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function buyHeight(quiet = false) {
  if (state.height >= MAX_LEVEL) return;
  const cost = heightCost();
  if (state.cores < cost) return;
  state.cores -= cost;
  state.height += 1;
  if (!quiet) addLog(`高度 +1 → ${state.height}。`);
  afterChange();
}

function buyReactor(quiet = false) {
  if (state.reactor >= MAX_LEVEL) return;
  const cost = reactorCost();
  if (state.cores < cost) return;
  state.cores -= cost;
  state.reactor += 1;
  if (!quiet) addLog(`反应堆 +1 → ${state.reactor}。`);
  afterChange();
}

function buyArrow() {
  if (state.k >= MAX_ARROWS) return;
  const cost = arrowCost();
  if (state.cores < cost) return;
  if (!energyAtLeast(arrowThreshold(state.k))) return;
  state.cores -= cost;
  state.k += 1;
  addLog(`维度跃迁：解锁 ${state.k} 个箭头 ${"↑".repeat(state.k)}。`);
  flash();
  afterChange();
}

function afterChange() {
  checkVictory();
  render();
  save();
}

function autoBuy() {
  if (canBuyArrow()) {
    buyArrow();
    return;
  }

  const hc = heightCost();
  const rc = reactorCost();
  const canHeight = state.height < MAX_LEVEL && state.cores >= hc;
  const canReactor = state.reactor < MAX_LEVEL && state.cores >= rc;

  if (canHeight && (!canReactor || hc <= rc)) buyHeight(true);
  else if (canReactor) buyReactor(true);
  else if (canHeight) buyHeight(true);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let flashTimer = 0;

function flash() {
  const el = $("energy");
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove("flash"), 400);
}

function addLog(text) {
  state.log.unshift({ t: Date.now(), text: String(text) });
  state.log = state.log.slice(0, 8);
  renderLog();
}

function renderLog() {
  const list = $("log");
  if (!state.log.length) {
    list.innerHTML = '<li class="empty">还没有事件。点击「采集能量」开始。</li>';
    return;
  }
  list.innerHTML = state.log.map((entry) => {
    const t = Number(entry.t) || Date.now();
    const time = new Date(t).toLocaleTimeString("zh-CN", { hour12: false });
    return `<li><time>${escapeHtml(time)}</time><span>${escapeHtml(entry.text)}</span></li>`;
  }).join("");
}

function render() {
  const r = rate();
  const hc = heightCost();
  const rc = reactorCost();
  const ac = arrowCost();
  const threshold = state.k < MAX_ARROWS ? arrowThreshold(state.k) : null;
  const reqMet = threshold !== null && energyAtLeast(threshold);

  $("energy").textContent = formatEnergy();
  $("rate").textContent = formatRate();
  $("ticks").textContent = state.ticks.toLocaleString("zh-CN");
  $("core-rate").textContent = `${formatInt(coreRate())}/s`;
  $("cores").textContent = formatInt(state.cores);

  $("arrows").textContent = String(state.k);
  $("height").textContent = String(state.height);
  $("reactor").textContent = String(state.reactor);
  $("height-level").textContent = String(state.height);
  $("reactor-level").textContent = String(state.reactor);
  $("arrow-count").textContent = String(state.k);

  const clickBonus = 1 + state.k;
  $("collect-sub").textContent = `+${clickBonus} 脉冲 · +${clickBonus} 核心`;
  $("rate-structure").textContent = String(r);

  $("height-cost").textContent = state.height >= MAX_LEVEL ? "MAX" : formatInt(hc);
  $("reactor-cost").textContent = state.reactor >= MAX_LEVEL ? "MAX" : formatInt(rc);
  $("buy-height").disabled = state.height >= MAX_LEVEL || state.cores < hc;
  $("buy-reactor").disabled = state.reactor >= MAX_LEVEL || state.cores < rc;

  if (state.k >= MAX_ARROWS) {
    $("arrow-cost").textContent = "—";
    $("arrow-req").textContent = "已达最高箭头维度。";
    $("arrow-req").classList.add("met");
    $("buy-arrow").disabled = true;
  } else {
    $("arrow-cost").textContent = formatInt(ac);
    $("arrow-req").textContent = reqMet
      ? "能量条件已满足。"
      : `需要能量 ≥ ${formatBig(threshold, 4)}`;
    $("arrow-req").classList.toggle("met", reqMet);
    $("buy-arrow").disabled = state.cores < ac || !reqMet;
  }

  const needed = 10 - (state.height + state.reactor);
  if (state.won) {
    $("goal-status").textContent = "目标达成：产能已经越过 10↑↑↑↑↑↑↑10。";
  } else if (state.k < MAX_ARROWS) {
    $("goal-status").textContent = `先解锁 7 个箭头（当前 ${state.k}/7）。`;
  } else if (needed > 0) {
    $("goal-status").textContent = `还需 ${needed} 级高度/反应堆，把产能推到 10↑↑↑↑↑↑↑10。`;
  } else {
    $("goal-status").textContent = "产能已达标，正在确认……";
  }

  $("auto-buy").checked = state.autoBuy;
}

function showVictory() {
  $("victory-rate").textContent = formatRate();
  $("victory-energy").textContent = formatEnergy();
  $("victory").classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------

function save() {
  if (suppressSave) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      k: state.k,
      height: state.height,
      reactor: state.reactor,
      ticks: state.ticks.toString(),
      cores: state.cores,
      coreFraction: state.coreFraction,
      clicks: state.clicks,
      autoBuy: state.autoBuy,
      won: state.won,
      log: state.log.slice(0, 8),
      savedAt: Date.now(),
    }));
  } catch {
    // localStorage 可能被禁用；游戏仍可继续运行。
  }
}

function clampInt(value, lo, hi) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function load() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
  } catch {
    data = null;
  }

  if (!data) {
    addLog("欢迎来到超指数工厂。点击「采集能量」开始。");
    return;
  }

  state.k = clampInt(data.k, 0, MAX_ARROWS);
  state.height = clampInt(data.height, 1, MAX_LEVEL);
  state.reactor = clampInt(data.reactor, 0, MAX_LEVEL);
  state.cores = Math.min(1e15, Math.max(0, Math.floor(Number(data.cores) || 0)));
  state.coreFraction = Math.min(1, Math.max(0, Number(data.coreFraction) || 0));
  state.clicks = Math.min(1e15, Math.max(0, Math.floor(Number(data.clicks) || 0)));
  state.autoBuy = Boolean(data.autoBuy);
  state.won = Boolean(data.won);
  state.log = Array.isArray(data.log) ? data.log.slice(0, 8) : [];

  try {
    state.ticks = BigInt(data.ticks ?? "0");
  } catch {
    state.ticks = 0n;
  }
  if (state.ticks < 0n) state.ticks = 0n;

  const savedAt = Number(data.savedAt) || Date.now();
  const away = Math.min(8 * 3600, Math.max(0, (Date.now() - savedAt) / 1000));
  if (away >= 5) {
    const gainedTicks = Math.floor(away * TICKS_PER_SECOND);
    const gainedCores = Math.floor(coreRate() * away);
    state.ticks += BigInt(gainedTicks);
    state.cores += gainedCores;
    addLog(`离线 ${formatDuration(away)}：+${gainedTicks.toLocaleString("zh-CN")} 脉冲，+${formatInt(gainedCores)} 核心。`);
  }

  if (state.won) addLog("读档：本局已经达成 10↑↑↑↑↑↑↑10。");
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

let lastTime = performance.now();
let tickAccumulator = 0;
let lastAutoBuy = 0;
let hiddenAt = 0;
let isHidden = false;

function tick() {
  if (isHidden) return;

  const now = performance.now();
  const dt = Math.min(1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

  tickAccumulator += dt;
  let newTicks = 0;
  const step = 1 / TICKS_PER_SECOND;
  while (tickAccumulator >= step) {
    tickAccumulator -= step;
    newTicks += 1;
  }
  if (newTicks > 0) state.ticks += BigInt(newTicks);

  state.coreFraction += coreRate() * dt;
  const wholeCores = Math.floor(state.coreFraction);
  if (wholeCores > 0) {
    state.cores += wholeCores;
    state.coreFraction -= wholeCores;
  }

  if (state.autoBuy && now - lastAutoBuy >= 500) {
    lastAutoBuy = now;
    autoBuy();
  }

  checkVictory();
  render();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("collect").addEventListener("click", () => {
  const bonus = 1 + state.k;
  state.ticks += BigInt(bonus);
  state.cores += bonus;
  state.clicks += 1;
  flash();
  checkVictory();
  render();
});

$("buy-height").addEventListener("click", () => buyHeight());
$("buy-reactor").addEventListener("click", () => buyReactor());
$("buy-arrow").addEventListener("click", () => buyArrow());

$("auto-buy").addEventListener("change", (event) => {
  state.autoBuy = event.target.checked;
  save();
  render();
});

$("reset").addEventListener("click", () => {
  if (!confirm("确定重置所有进度？此操作不可撤销。")) return;
  suppressSave = true;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
  location.reload();
});

$("victory-close").addEventListener("click", () => {
  $("victory").classList.add("hidden");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    isHidden = true;
    save();
    hiddenAt = Date.now();
    return;
  }

  isHidden = false;
  if (hiddenAt) {
    const away = Math.min(3600, Math.max(0, (Date.now() - hiddenAt) / 1000));
    if (away >= 2) {
      const gainedTicks = Math.floor(away * TICKS_PER_SECOND);
      const gainedCores = Math.floor(coreRate() * away);
      state.ticks += BigInt(gainedTicks);
      state.cores += gainedCores;
      addLog(`离开 ${formatDuration(away)}：+${gainedTicks.toLocaleString("zh-CN")} 脉冲，+${formatInt(gainedCores)} 核心。`);
    }
    hiddenAt = 0;
    lastTime = performance.now();
    tickAccumulator = 0;
    render();
  }
});

window.addEventListener("beforeunload", save);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

load();
checkVictory();
render();
renderLog();

setInterval(tick, TICK_MS);
setInterval(save, 5000);
