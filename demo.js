// Run `node demo.js` to see the library in action.

import { Incomparable, compare, log10, num, pow, sci, up } from "./bignumber.js";

const x = up(10, 7, 10);

console.log("x              =", String(x));
console.log("sci(x, 2)      =", sci(x, 2));
console.log("x + 1          =", String(x.add(1)));
console.log("x * 2          =", String(x.mul(2)));
console.log("log10(x)       =", String(log10(x)));
console.log();
console.log("x > 10↑↑↑↑↑↑10  =", x.cmp(up(10, 6, 10)) > 0);
console.log("x > 10↑↑↑↑↑↑↑9  =", x.cmp(up(10, 7, 9)) > 0);
console.log("x > 10↑↑↑↑↑↑9   =", x.cmp(up(10, 6, 9)) > 0);
console.log("x > 3↑↑↑↑↑↑↑↑10 =", x.cmp(up(3, 8, 10)) > 0);
console.log("x > 2↑¹⁰⁰10     =", x.cmp(up(2, 100, 10)) > 0);
console.log("x > 10^100000   =", x.cmp(num(10n ** 100000n)) > 0);
console.log();
console.log("3↑↑3           =", String(up(3, 2, 3)), "->", sci(up(3, 2, 3)));
console.log("10↑↑3          =", String(up(10, 2, 3)), "->", sci(up(10, 2, 3)));
console.log("10↑↑4          =", String(up(10, 2, 4)), "->", sci(up(10, 2, 4)));
console.log("10↑↑10         =", sci(up(10, 2, 10)));
console.log();
console.log(
  "10↑↑3 == 10^(10^10) ->",
  compare(up(10, 2, 3), pow(10, pow(10, 10))) === 0,
);

try {
  compare(up(10, 3, 3), up(2, 3, 100));
} catch (exc) {
  if (exc instanceof Incomparable) console.log("Incomparable:", exc.message);
  else throw exc;
}
