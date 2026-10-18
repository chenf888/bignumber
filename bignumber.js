/**
 * bignumber.js -- symbolic big numbers with Knuth up-arrows.
 *
 *   import { up, sci } from "./bignumber.js";
 *   const x = up(10, 7, 10);   // 10 ↑↑↑↑↑↑↑ 10
 *   console.log(String(x));    // 10↑↑↑↑↑↑↑10
 *   console.log(sci(x));       // 10↑↑↑↑↑↑↑10
 *
 * Values are canonical expression trees.  An expression becomes a BigInt only
 * while the result fits in EVAL_BITS bits; everything else stays symbolic.
 * `sci(x, prec = 2)` prints at most `prec` significant digits.
 */

export const EVAL_BITS = 1 << 16; // about 19,700 decimal digits
export const MAX_LOG_DEPTH = 200;
export const MAX_NODES = 4000;

export class Incomparable extends Error {
  constructor(message) {
    super(message);
    this.name = "Incomparable";
  }
}

export class OverflowError extends RangeError {
  constructor(message) {
    super(message);
    this.name = "OverflowError";
  }
}

const TOKEN = Symbol("BigNum");
const INTERN = new Map();

export class BigNum {
  constructor(op, args, k, key, token) {
    if (token !== TOKEN) {
      throw new TypeError("BigNum nodes are created by num/add/mul/pow/up");
    }
    this.op = op;       // i int, a sum, m product, p power, u arrows, l log, d decrement
    this.args = args;
    this.k = k;
    this.key = key;
    Object.freeze(this.args);
    Object.freeze(this);
  }

  add(other) { return add(this, other); }
  mul(other) { return mul(this, other); }
  pow(other) { return pow(this, other); }
  cmp(other) { return compare(this, other); }
  toBigInt() { return toBigInt(this); }
  toString() { return render(this); }

  valueOf() {
    throw new TypeError("BigNum has no numeric value; use add/mul/pow/compare");
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return render(this);
  }
}

function nodeKey(op, args, k) {
  switch (op) {
    case "i": return `i:${args[0]}`;
    case "a": return `a(${args.map((x) => x.key).join(",")})`;
    case "m": return `m(${args.map((x) => x.key).join(",")})`;
    case "p": return `p(${args[0].key},${args[1].key})`;
    case "u": return `u${k}(${args[0].key},${args[1].key})`;
    case "l": return `l(${args[0].key})`;
    case "d": return `d(${args[0].key})`;
    default: throw new Error(`unknown op: ${op}`);
  }
}

function intern(op, args, k = 0) {
  const key = nodeKey(op, args, k);
  let node = INTERN.get(key);
  if (node !== undefined) return node;
  node = new BigNum(op, args, k, key, TOKEN);
  INTERN.set(key, node);
  return node;
}

export function num(n) {
  if (n instanceof BigNum) return n;
  let v;
  if (typeof n === "bigint") {
    v = n;
  } else if (typeof n === "number") {
    if (!Number.isInteger(n)) throw new TypeError("num() expects an integer");
    if (!Number.isSafeInteger(n)) {
      throw new TypeError("number is outside the safe integer range; use BigInt or a string");
    }
    v = BigInt(n);
  } else if (typeof n === "string") {
    v = BigInt(n);
  } else {
    throw new TypeError("num() expects a BigInt, safe integer, or integer string");
  }
  return intern("i", [v]);
}

function coerce(x) {
  return x instanceof BigNum ? x : num(x);
}

function cmpSort(a, b) {
  const ai = a.op === "i" ? 1 : 0;
  const bi = b.op === "i" ? 1 : 0;
  if (ai !== bi) return ai - bi;
  if (a.op !== b.op) return a.op < b.op ? -1 : 1;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Canonical constructors
// ---------------------------------------------------------------------------

export function add(...xs) {
  const flat = [];
  let total = 0n;
  for (let x of xs) {
    x = coerce(x);
    if (x.op === "i") total += x.args[0];
    else if (x.op === "a") flat.push(...x.args);
    else flat.push(x);
  }
  if (total !== 0n) flat.push(num(total));
  if (flat.length === 0) return num(0);
  if (flat.length === 1) return flat[0];
  flat.sort(cmpSort);
  return intern("a", flat);
}

export function mul(...xs) {
  const flat = [];
  let prod = 1n;
  for (let x of xs) {
    x = coerce(x);
    if (x.op === "i") prod *= x.args[0];
    else if (x.op === "m") flat.push(...x.args);
    else flat.push(x);
  }
  if (prod === 0n) return num(0);
  if (prod !== 1n) flat.push(num(prod));
  if (flat.length === 0) return num(1);

  const counts = new Map();
  for (const x of flat) counts.set(x, (counts.get(x) || 0) + 1);
  const out = [];
  for (const [x, c] of counts) out.push(c > 1 ? pow(x, num(c)) : x);
  if (out.length === 1) return out[0];
  out.sort(cmpSort);
  return intern("m", out);
}

function bitLength(n) {
  if (n < 0n) n = -n;
  return n === 0n ? 0 : n.toString(2).length;
}

function powFits(base, exp) {
  if (exp < 0n) return false;
  if (exp === 0n || base === 0n || base === 1n) return true;
  return exp * BigInt(bitLength(base)) <= BigInt(EVAL_BITS);
}

export function pow(a, b) {
  a = coerce(a);
  b = coerce(b);

  if (b.op === "i") {
    const e = b.args[0];
    if (e === 0n) return num(1);
    if (e === 1n) return a;
    if (a.op === "i") {
      const base = a.args[0];
      if (base === 0n) return num(0);
      if (base === 1n) return num(1);
      if (powFits(base, e)) return num(base ** e);
    }
    if (a.op === "p") {
      // (x^y)^e = x^(y*e)
      return pow(a.args[0], mul(a.args[1], b));
    }
    return intern("p", [a, b]);
  }

  if (a.op === "i" && a.args[0] === 1n) return num(1);
  if (a.op === "i" && a.args[0] === 0n) return num(0);
  return intern("p", [a, b]);
}

export const power = pow;

export function pred(x) {
  x = coerce(x);
  if (x.op === "i") return num(x.args[0] - 1n);
  return intern("d", [x]);
}

function exactUpInt(base, k, n) {
  if (n < 0n || base < 0n) return null;
  if (n === 0n) return 1n;
  if (n === 1n) return base;
  if (k === 1) return powFits(base, n) ? base ** n : null;
  if (base === 0n) return n % 2n === 0n ? 1n : 0n;
  if (base === 1n) return 1n;
  if (n > 1000n) return null;

  let r = base;
  for (let i = 2n; i <= n; i++) {
    r = exactUpInt(base, k - 1, r);
    if (r === null) return null;
  }
  return r;
}

export function up(a, k, b) {
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError("arrow count k must be a positive integer");
  }
  a = coerce(a);
  b = coerce(b);

  if (b.op === "i") {
    const n = b.args[0];
    if (n < 0n) throw new RangeError("arrow height must be >= 0");
    if (n === 0n) return num(1);
    if (n === 1n) return a;
    if (k === 1) return pow(a, b);
    if (a.op === "i" && a.args[0] === 1n) return num(1);
    if (a.op === "i" && a.args[0] === 0n) return num(n % 2n === 0n ? 1 : 0);
    if (n === 2n) return up(a, k - 1, a);
  }

  if (k === 1) return pow(a, b);
  if (a.op === "i" && a.args[0] === 1n) return num(1);

  const exact = a.op === "i" && b.op === "i"
    ? exactUpInt(a.args[0], k, b.args[0])
    : null;
  if (exact !== null) return num(exact);
  return intern("u", [a, b], k);
}

// ---------------------------------------------------------------------------
// Exact symbolic log10
// ---------------------------------------------------------------------------

function log10Exact(n) {
  const s = n.toString();
  if (s[0] === "1" && /^0*$/.test(s.slice(1))) return BigInt(s.length - 1);
  return null;
}

export function log10(x) {
  x = coerce(x);
  switch (x.op) {
    case "i": {
      const n = x.args[0];
      if (n <= 0n) throw new RangeError("log10 is defined for positive numbers");
      if (n === 1n) return num(0);
      const e = log10Exact(n);
      return e !== null ? num(e) : intern("l", [x]);
    }
    case "a":
      return intern("l", [x]);
    case "m":
      return add(...x.args.map((y) => log10(y)));
    case "p":
      return mul(x.args[1], log10(x.args[0]));
    case "u": {
      const [a, b] = x.args;
      if (x.k === 1) return mul(b, log10(a));
      return log10(up(a, x.k - 1, up(a, x.k, pred(b))));
    }
    case "l":
    case "d":
      return intern("l", [x]);
    default:
      throw new Error(`unknown node: ${x.op}`);
  }
}

// ---------------------------------------------------------------------------
// Float logarithm: fast magnitude estimate
// ---------------------------------------------------------------------------

const LOG10_CACHE = new Map();

function log10Int(n) {
  if (n <= 0n) return null;
  if (n < (1n << 1000n)) return Math.log10(Number(n));
  const s = n.toString();
  const length = s.length;
  const lead = Number(s.slice(0, 16));
  return Math.log10(lead) + (length - 16);
}

function log10Float(x) {
  if (LOG10_CACHE.has(x)) return LOG10_CACHE.get(x);
  const result = computeLog10Float(x);
  LOG10_CACHE.set(x, result);
  return result;
}

function computeLog10Float(x) {
  switch (x.op) {
    case "i":
      return log10Int(x.args[0]);

    case "l": {
      const v = log10Float(x.args[0]);
      if (v === null || v <= 0) return null;
      return Math.log10(v);
    }

    case "d": {
      const inner = x.args[0];
      if (inner.op === "i") {
        const n = inner.args[0];
        return n > 1n ? log10Int(n - 1n) : null;
      }
      return log10Float(inner);
    }

    case "a": {
      const vals = [];
      for (const y of x.args) {
        const v = log10Float(y);
        if (v === null) return null;
        vals.push(v);
      }
      let m = vals[0];
      for (const v of vals) if (v > m) m = v;
      if (m > 1e300) return m;
      let sum = 0;
      for (const v of vals) sum += 10 ** (v - m);
      return m + Math.log10(sum);
    }

    case "m": {
      let total = 0;
      for (const y of x.args) {
        const v = log10Float(y);
        if (v === null) return null;
        total += v;
        if (!Number.isFinite(total)) return null;
      }
      return total;
    }

    case "p": {
      const [a, b] = x.args;
      const la = log10Float(a);
      if (la === null) return null;
      if (b.op !== "i") return null;
      const bb = b.args[0];
      if (bb <= 0n) return null;
      const bf = Number(bb);
      if (!Number.isFinite(bf)) return null;
      const v = bf * la;
      return Number.isFinite(v) ? v : null;
    }

    case "u": {
      const [a, b] = x.args;
      if (x.k === 1) return log10Float(pow(a, b));
      if (b.op !== "i") return null;
      const nBig = b.args[0];
      if (nBig === 1n) return log10Float(a);
      if (x.k === 2) {
        // For any base >= 2, height >= 6 already has log10 > 1e308.
        if (nBig >= 6n) return null;
        const n = Number(nBig);
        const inner = up(a, 2, num(n - 1));
        const li = log10Float(inner);
        const la = log10Float(a);
        if (li === null || la === null || li > 300) return null;
        const v = (10 ** li) * la;
        return Number.isFinite(v) ? v : null;
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

const SIZE_CACHE = new Map();

function size(x) {
  if (SIZE_CACHE.has(x)) return SIZE_CACHE.get(x);
  let total = 1;
  if (x.op !== "i") {
    for (const y of x.args) {
      total += size(y);
      if (total > MAX_NODES) {
        total = MAX_NODES + 1;
        break;
      }
    }
  }
  SIZE_CACHE.set(x, total);
  return total;
}

function short(x, n = 80) {
  let s = render(x);
  s = s.replace(/(?:-1\)){3,}/g, "-1)…");
  s = s.replace(/(.)\1{3,}/g, (_, c) => c + c + "…");
  return s.length <= n ? s : s.slice(0, n - 3) + "...";
}

function dominantTerm(x) {
  const logs = [];
  const huge = [];
  for (const t of x.args) {
    const v = log10Float(t);
    if (v === null) huge.push(t);
    else logs.push([v, t]);
  }
  if (huge.length === 1) return huge[0];
  if (huge.length > 1) return null;
  if (logs.length === 1) return logs[0][1];
  logs.sort((p, q) => p[0] - q[0]);
  const [vMax, tMax] = logs[logs.length - 1];
  const [vSecond] = logs[logs.length - 2];
  return vMax > 0 && vMax > vSecond + 10 ? tMax : null;
}

function dominantFactor(x) {
  const logs = [];
  const huge = [];
  for (const t of x.args) {
    const v = log10Float(t);
    if (v === null) huge.push(t);
    else logs.push([v, t]);
  }
  if (huge.length === 1) return huge[0];
  if (huge.length > 1) return null;
  if (logs.length === 1) return logs[0][1];

  let total = 0;
  let vMax = -Infinity;
  let tMax = null;
  for (const [v, t] of logs) {
    total += v;
    if (v > vMax) {
      vMax = v;
      tMax = t;
    }
  }
  return vMax > 0 && vMax > total - vMax + 10 ? tMax : null;
}

function countMap(args) {
  const m = new Map();
  for (const a of args) m.set(a, (m.get(a) || 0) + 1);
  return m;
}

function countsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function countsContain(a, b) {
  for (const [k, v] of b) if ((a.get(k) || 0) < v) return false;
  return true;
}

function countSubtract(a, b) {
  const r = new Map();
  for (const [k, v] of a) {
    const d = v - (b.get(k) || 0);
    if (d > 0) r.set(k, d);
  }
  return r;
}

function countElements(m) {
  const out = [];
  for (const [k, v] of m) for (let i = 0; i < v; i++) out.push(k);
  return out;
}

function sign(n) {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

function cmpStruct(x, y, depth) {
  if (x.op === "a" && x.args.includes(y)) return 1;
  if (y.op === "a" && y.args.includes(x)) return -1;
  if (x.op === "m" && x.args.includes(y)) return 1;
  if (y.op === "m" && y.args.includes(x)) return -1;

  if (x.op === "a" && y.op === "a") {
    const cx = countMap(x.args);
    const cy = countMap(y.args);
    if (!countsEqual(cx, cy)) {
      if (countsContain(cx, cy)) return 1;
      if (countsContain(cy, cx)) return -1;
      const common = new Map();
      for (const [k, v] of cx) {
        const w = Math.min(v, cy.get(k) || 0);
        if (w > 0) common.set(k, w);
      }
      const rx = countElements(countSubtract(cx, common));
      const ry = countElements(countSubtract(cy, common));
      if (rx.length === 1 && ry.length === 1) {
        return compare(rx[0], ry[0], depth + 1);
      }
    }
  }

  if (x.op === "m" && y.op === "m") {
    const cx = countMap(x.args);
    const cy = countMap(y.args);
    if (!countsEqual(cx, cy)) {
      if (countsContain(cx, cy)) return 1;
      if (countsContain(cy, cx)) return -1;
      const common = new Map();
      for (const [k, v] of cx) {
        const w = Math.min(v, cy.get(k) || 0);
        if (w > 0) common.set(k, w);
      }
      const rx = countElements(countSubtract(cx, common));
      const ry = countElements(countSubtract(cy, common));
      if (rx.length === 1 && ry.length === 1) {
        return compare(rx[0], ry[0], depth + 1);
      }
    }
  }

  // A sum with one overwhelmingly large term has that term's order.
  if (x.op === "a" && y.op !== "a") {
    const d = dominantTerm(x);
    if (d !== null) return compare(d, y, depth + 1);
  }
  if (y.op === "a" && x.op !== "a") {
    const d = dominantTerm(y);
    if (d !== null) return compare(x, d, depth + 1);
  }

  // Likewise for a product with one overwhelmingly large factor.
  if (x.op === "m" && y.op !== "m") {
    const d = dominantFactor(x);
    if (d !== null) return compare(d, y, depth + 1);
  }
  if (y.op === "m" && x.op !== "m") {
    const d = dominantFactor(y);
    if (d !== null) return compare(x, d, depth + 1);
  }

  if (x.op === "u" && y.op === "u") {
    const [a1, b1] = x.args;
    const [a2, b2] = y.args;

    if (a1 === a2 && b1 === b2) return sign(x.k - y.k);
    if (a1 === a2 && x.k === y.k) return compare(b1, b2, depth + 1);
    if (b1 === b2 && x.k === y.k) return compare(a1, a2, depth + 1);

    // Equal height >= 4 and ordinary integer parameters: one extra
    // hyperoperation level dominates the base difference.
    if (
      b1 === b2 && x.k !== y.k &&
      b1.op === "i" && b1.args[0] >= 4n &&
      a1.op === "i" && a2.op === "i" &&
      a1.args[0] <= 1000000n && a2.args[0] <= 1000000n
    ) {
      return sign(x.k - y.k);
    }

    // Tetration: for integer bases a height lead of > 8 is decisive.
    if (
      x.k === 2 && y.k === 2 &&
      b1.op === "i" && b2.op === "i" &&
      a1.op === "i" && a2.op === "i"
    ) {
      const h1 = b1.args[0];
      const h2 = b2.args[0];
      if (h1 > h2 + 8n) return 1;
      if (h2 > h1 + 8n) return -1;
    }

    // Different bases: an astronomically taller tower still wins.
    if (x.k === 2 && y.k === 2 && a1 !== a2) {
      const l1 = log10Float(b1);
      const l2 = log10Float(b2);
      if (l1 === null && l2 !== null) return 1;
      if (l2 === null && l1 !== null) return -1;
      if (l1 !== null && l2 !== null && Math.abs(l1 - l2) > 2) {
        return sign(l1 - l2);
      }
    }
  }

  if (x.op === "p" && y.op === "p") {
    const [a1, b1] = x.args;
    const [a2, b2] = y.args;
    if (a1 === a2) return compare(b1, b2, depth + 1);
    if (b1 === b2) return compare(a1, a2, depth + 1);
  }

  return null;
}

export function compare(x, y, depth = 0) {
  x = coerce(x);
  y = coerce(y);

  if (x === y) return 0;

  if (x.op === "i" && y.op === "i") {
    const a = x.args[0];
    const b = y.args[0];
    return a > b ? 1 : a < b ? -1 : 0;
  }

  // Zero and negative literals are small; symbolic nodes are positive.
  if (x.op === "i" && x.args[0] <= 0n) return -1;
  if (y.op === "i" && y.args[0] <= 0n) return 1;

  if (x.op === "d") {
    const A = x.args[0];
    const c = compare(A, y, depth + 1);
    if (c > 0) return A === add(y, num(1)) ? 0 : 1;
    return -1;
  }
  if (y.op === "d") {
    const A = y.args[0];
    const c = compare(x, A, depth + 1);
    if (c < 0) return add(x, num(1)) === A ? 0 : -1;
    return 1;
  }

  if (x.op === "l" && y.op === "l") {
    return compare(x.args[0], y.args[0], depth + 1);
  }

  const c = cmpStruct(x, y, depth);
  if (c !== null) return c;

  const lx = log10Float(x);
  const ly = log10Float(y);
  if (lx !== null && ly !== null) {
    if (Number.isFinite(lx) && Number.isFinite(ly)) {
      const margin = 1e-9 * Math.max(1, Math.abs(lx), Math.abs(ly));
      if (lx < ly - margin) return -1;
      if (lx > ly + margin) return 1;
    }
  } else if (lx === null && ly !== null) {
    return 1;
  } else if (ly === null && lx !== null) {
    return -1;
  }

  if (depth > MAX_LOG_DEPTH) {
    throw new Incomparable(`cannot compare ${short(x)} and ${short(y)}`);
  }
  if (x.op === "a" && y.op === "a") {
    throw new Incomparable(`cannot compare sums ${short(x)} and ${short(y)}`);
  }
  if (x.op === "m" && y.op === "m") {
    throw new Incomparable(`cannot compare products ${short(x)} and ${short(y)}`);
  }
  if (size(x) + size(y) > MAX_NODES) {
    throw new Incomparable(`cannot compare ${short(x)} and ${short(y)}`);
  }

  const lx2 = log10(x);
  const ly2 = log10(y);
  if (lx2 === ly2) return 0;
  if (lx2 === intern("l", [x]) || ly2 === intern("l", [y])) {
    throw new Incomparable(`cannot compare ${short(x)} and ${short(y)}`);
  }
  return compare(lx2, ly2, depth + 1);
}

// ---------------------------------------------------------------------------
// Short decimal output: only `prec` significant digits
// ---------------------------------------------------------------------------

function sciInt(n, prec) {
  const negative = n < 0n;
  const s = (negative ? -n : n).toString();
  const signText = negative ? "-" : "";
  if (s.length <= prec) return signText + s;
  if (prec === 1) return `${signText}${s[0]}e${s.length - 1}`;
  return `${signText}${s[0]}.${s.slice(1, prec)}e${s.length - 1}`;
}

export function sci(x, prec = 2, depth = 0) {
  x = coerce(x);
  prec = Math.max(1, Math.trunc(prec));

  if (x.op === "i") return sciInt(x.args[0], prec);

  const l = log10Float(x);
  if (l !== null && Number.isFinite(l) && l < 1e15) {
    let e = Math.floor(l);
    let m = 10 ** (l - e);
    if (m >= 10 - 0.5 * 10 ** (-(prec - 1))) {
      m /= 10;
      e += 1;
    }
    if (prec === 1) return `${m.toFixed(0)}e${e}`;
    return `${m.toFixed(prec - 1)}e${e}`;
  }

  if (depth < 12) {
    if (x.op === "p") {
      const [a, b] = x.args;
      return `${sci(a, prec, depth + 1)}^(${sci(b, prec, depth + 1)})`;
    }
    if (x.op === "u" && x.k === 2 && x.args[1].op === "i") {
      const [a, b] = x.args;
      const n = b.args[0];
      if (n >= 1n && n <= 12n) {
        if (n === 1n) return sci(a, prec, depth + 1);
        const inner = up(a, 2, num(n - 1n));
        return `${sci(a, prec, depth + 1)}^(${sci(inner, prec, depth + 1)})`;
      }
    }
  }

  return render(x);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PREC = { a: 1, m: 2, p: 3, u: 4, i: 9, l: 9, d: 9 };

function operand(x, minPrec) {
  const s = render(x);
  return (PREC[x.op] ?? 9) < minPrec ? `(${s})` : s;
}

function render(x) {
  switch (x.op) {
    case "i":
      return x.args[0].toString();
    case "a":
      return x.args.map((y) => operand(y, 1)).join(" + ");
    case "m":
      return x.args.map((y) => operand(y, 2)).join("*");
    case "p": {
      const [a, b] = x.args;
      return `${operand(a, 5)}^${operand(b, 5)}`;
    }
    case "u": {
      const [a, b] = x.args;
      return `${operand(a, 5)}${"↑".repeat(x.k)}${operand(b, 5)}`;
    }
    case "l":
      return `log(${render(x.args[0])})`;
    case "d":
      return `(${render(x.args[0])}-1)`;
    default:
      return `${x.op}(${x.args.join(",")})`;
  }
}

export function toBigInt(x) {
  x = coerce(x);
  if (x.op === "i") return x.args[0];
  throw new OverflowError("symbolic value is too large to convert to BigInt");
}
