import test from "node:test";
import assert from "node:assert/strict";

import {
  Incomparable,
  OverflowError,
  add,
  compare,
  log10,
  mul,
  num,
  pow,
  pred,
  sci,
  toBigInt,
  up,
} from "./bignumber.js";

test("small arithmetic", () => {
  assert.strictEqual(add(num(2), num(3)), num(5));
  assert.strictEqual(mul(num(2), num(3)), num(6));
  assert.strictEqual(pow(2, 10), num(1024));
  assert.strictEqual(up(10, 1, 3), num(1000));
});

test("tetration that fits", () => {
  assert.strictEqual(up(2, 2, 4), num(65536));
  assert.strictEqual(up(3, 2, 3), num(3n ** 27n));
});

test("canonical forms", () => {
  const x = up(10, 7, 10);
  assert.strictEqual(String(add(x, 1)), "10↑↑↑↑↑↑↑10 + 1");
  assert.strictEqual(String(mul(x, 2)), "10↑↑↑↑↑↑↑10*2");
  assert.strictEqual(add(x, 1), add(1, x));
  assert.strictEqual(mul(x, 2), mul(2, x));
});

test("int conversion", () => {
  assert.strictEqual(toBigInt(up(2, 2, 4)), 65536n);
  assert.throws(() => toBigInt(up(10, 7, 10)), OverflowError);
});

test("target number", () => {
  const x = up(10, 7, 10);
  assert.strictEqual(String(x), "10↑↑↑↑↑↑↑10");
  assert.strictEqual(x.k, 7);
  assert.strictEqual(String(up(10, 2, 3)), "10↑↑3");
});

test("same value, different shape", () => {
  // 10↑↑3 == 10^(10^10)
  const a = up(10, 2, 3);
  const b = pow(10, pow(10, 10));
  assert.strictEqual(compare(a, b), 0);
});

test("log10 is exact", () => {
  // log10(10↑↑4) == 10↑↑3
  assert.strictEqual(log10(up(10, 2, 4)), up(10, 2, 3));
  // log10(10↑↑↑3) == 10↑↑(10↑↑10 - 1)
  const lhs = log10(up(10, 3, 3));
  const rhs = up(10, 2, pred(up(10, 2, 10)));
  assert.strictEqual(lhs, rhs);
});

test("arrow monotonicity", () => {
  const x = up(10, 7, 10);
  assert.ok(compare(x, up(10, 6, 10)) > 0);
  assert.ok(compare(x, up(10, 7, 9)) > 0);
  assert.ok(compare(x, up(10, 6, 9)) > 0);
});

test("tetration", () => {
  assert.ok(compare(up(10, 2, 4), up(10, 2, 3)) > 0);
  assert.ok(compare(up(10, 2, 3), num(10n ** 100n)) > 0);
  assert.ok(compare(up(10, 2, 3), pow(10, 10 ** 9)) > 0);
});

test("mixed bases", () => {
  // 2↑↑5 = 2^65536 is just above 10^19728.
  assert.ok(compare(up(2, 2, 5), num(10n ** 19728n)) > 0);
  assert.ok(compare(up(2, 2, 5), num(10n ** 19729n)) < 0);
  assert.ok(compare(up(2, 2, 5), num(10n ** 100000n)) < 0);
});

test("cross-base arrows", () => {
  // One extra level dominates a small base difference at height 10.
  assert.ok(compare(up(10, 7, 10), up(3, 8, 10)) < 0);
  assert.ok(compare(up(10, 7, 10), up(2, 100, 10)) < 0);
  // Tetration height is decisive when the lead is large.
  assert.ok(compare(up(2, 2, 100), up(10, 2, 10)) > 0);
  assert.ok(compare(up(2, 2, 20), up(1000000, 2, 4)) > 0);
  assert.ok(compare(up(2, 2, 5), up(10, 2, 3)) < 0);
  assert.ok(compare(up(2, 2, 6), up(10, 2, 3)) > 0);
});

test("huge vs literal", () => {
  assert.ok(compare(up(10, 7, 10), num(10n ** 100000n)) > 0);
  assert.ok(compare(num(10n ** 100000n), up(10, 7, 10)) < 0);
});

test("symbolic arithmetic order", () => {
  const x = up(10, 7, 10);
  assert.ok(compare(add(x, 1), x) > 0);
  assert.ok(compare(mul(x, 2), x) > 0);
});

test("incomparable is explicit", () => {
  const x = add(up(10, 3, 3), num(1));
  const y = add(up(10, 3, 4), num(1));
  assert.ok(compare(y, x) > 0);

  const a = add(up(10, 3, 3), up(10, 2, 10));
  const b = add(up(10, 3, 4), up(10, 2, 9));
  assert.throws(() => compare(a, b), Incomparable);
});

test("two digits", () => {
  assert.strictEqual(sci(num(7625597484987n), 2), "7.6e12");
  assert.strictEqual(sci(num(123), 2), "1.2e2");
  assert.strictEqual(sci(num(12), 2), "12");
});

test("tetration output", () => {
  assert.strictEqual(sci(up(10, 2, 3), 2), "1.0e10000000000");
  assert.strictEqual(sci(up(10, 2, 4), 2), "10^(1.0e10000000000)");
});

test("target stays symbolic", () => {
  assert.strictEqual(sci(up(10, 7, 10), 2), "10↑↑↑↑↑↑↑10");
});

test("precision", () => {
  assert.strictEqual(sci(num(123456), 3), "1.23e5");
});
