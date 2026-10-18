"""bignumber.py -- a tiny symbolic big-number library for Knuth up-arrows.

    x = up(10, 7, 10)        # 10 ↑↑↑↑↑↑↑ 10
    print(x)                 # 10↑↑↑↑↑↑↑10
    print(sci(up(10, 2, 4))) # 10^(1.0e10000000000)

The library never tries to materialise a number that cannot fit in memory.
Values are canonical expression trees; an expression is evaluated to an int
only while the result fits in EVAL_BITS bits.  Everything else stays symbolic.

Output is deliberately short: `sci(x, prec=2)` uses at most `prec`
significant digits (2 by default).  Comparison is exact where the symbolic
logarithms can decide it, and raises `Incomparable` otherwise.

Only non-negative integers are supported as leaves.
"""

from __future__ import annotations

import math
import re
import sys
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache

__all__ = [
    "BigNum", "num", "add", "mul", "power", "up", "pred", "log10",
    "compare", "sci", "Incomparable", "EVAL_BITS",
]

# Largest exact integer we are willing to build, in bits.
# 1 << 16 is about 19,700 decimal digits.
EVAL_BITS = 1 << 16

# Safety valve for the symbolic-log comparison recursion.
MAX_LOG_DEPTH = 200
MAX_NODES = 4000

sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))

# Python 3.11+ refuses int<->str conversions above 4300 digits by default.
# A big-number library has to be able to look at its own literals.
if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)


class Incomparable(ValueError):
    """Raised when two symbolic values cannot be ordered cheaply."""


# --------------------------------------------------------------------------
# Expression node
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True, repr=False)
class BigNum:
    # i: int, a: sum, m: product, p: power, u: Knuth arrows,
    # l: log10, d: predecessor (x - 1)
    op: str
    args: tuple
    k: int = 0

    def __add__(self, other): return add(self, other)
    def __radd__(self, other): return add(other, self)
    def __mul__(self, other): return mul(self, other)
    def __rmul__(self, other): return mul(other, self)
    def __pow__(self, other): return power(self, other)
    def __rpow__(self, other): return power(other, self)
    def __lt__(self, other): return compare(self, other) < 0
    def __le__(self, other): return compare(self, other) <= 0
    def __gt__(self, other): return compare(self, other) > 0
    def __ge__(self, other): return compare(self, other) >= 0
    def __int__(self):
        if self.op == "i":
            return self.args[0]
        raise OverflowError("symbolic value is too large to convert to int")
    def __bool__(self):
        return not (self.op == "i" and self.args[0] == 0)
    def __str__(self): return _render(self)
    def __repr__(self): return _render(self)


def num(n: int) -> BigNum:
    """Wrap a Python int as a BigNum."""
    return BigNum("i", (int(n),))


def _coerce(x) -> BigNum:
    return x if isinstance(x, BigNum) else num(x)


# --------------------------------------------------------------------------
# Canonical constructors
# --------------------------------------------------------------------------

def _sort_key(x: BigNum):
    # Non-integers first, then by operator and text, so the tree is canonical.
    return (x.op == "i", x.op, str(x))


def add(*xs) -> BigNum:
    """Canonical sum of non-negative values."""
    flat: list[BigNum] = []
    total = 0
    for x in xs:
        x = _coerce(x)
        if x.op == "i":
            total += x.args[0]
        elif x.op == "a":
            flat.extend(x.args)
        else:
            flat.append(x)
    if total:
        flat.append(num(total))
    if not flat:
        return num(0)
    if len(flat) == 1:
        return flat[0]
    flat.sort(key=_sort_key)
    return BigNum("a", tuple(flat))


def mul(*xs) -> BigNum:
    """Canonical product of non-negative values."""
    flat: list[BigNum] = []
    prod = 1
    for x in xs:
        x = _coerce(x)
        if x.op == "i":
            prod *= x.args[0]
        elif x.op == "m":
            flat.extend(x.args)
        else:
            flat.append(x)
    if prod == 0:
        return num(0)
    if prod != 1:
        flat.append(num(prod))
    if not flat:
        return num(1)

    # x*x*... -> x^count
    out = []
    for x, c in Counter(flat).items():
        out.append(power(x, num(c)) if c > 1 else x)
    if len(out) == 1:
        return out[0]
    out.sort(key=_sort_key)
    return BigNum("m", tuple(out))


def _pow_fits(base: int, exp: int) -> bool:
    if exp < 0:
        return False
    if exp == 0 or base in (0, 1):
        return True
    return exp * base.bit_length() <= EVAL_BITS


def power(a, b) -> BigNum:
    """a ** b, exact when it fits, symbolic otherwise."""
    a, b = _coerce(a), _coerce(b)
    if b.op == "i":
        e = b.args[0]
        if e == 0:
            return num(1)
        if e == 1:
            return a
        if a.op == "i":
            base = a.args[0]
            if base == 0:
                return num(0)
            if base == 1:
                return num(1)
            if _pow_fits(base, e):
                return num(base ** e)
        if a.op == "p":
            # (x^y)^e == x^(y*e)
            return power(a.args[0], mul(a.args[1], b))
        return BigNum("p", (a, b))
    if a.op == "i" and a.args[0] == 1:
        return num(1)
    if a.op == "i" and a.args[0] == 0:
        return num(0)
    return BigNum("p", (a, b))


def pred(x) -> BigNum:
    """x - 1, kept symbolic when x is symbolic."""
    x = _coerce(x)
    if x.op == "i":
        return num(x.args[0] - 1)
    return BigNum("d", (x,))


def _exact_up_int(base: int, k: int, n: int):
    """Exact value of base ↑^k n, or None if it exceeds the budget."""
    if n < 0 or base < 0:
        return None
    if n == 0:
        return 1
    if n == 1:
        return base
    if k == 1:
        return base ** n if _pow_fits(base, n) else None
    if base == 0:
        return 1 if n % 2 == 0 else 0
    if base == 1:
        return 1

    # k >= 2, base >= 2.  Anything with height > 1000 is hopeless anyway,
    # and the loop bails out as soon as one power is too large.
    if n > 1000:
        return None
    r = base
    for _ in range(2, n + 1):
        r = _exact_up_int(base, k - 1, r)
        if r is None:
            return None
    return r


def _exact_up(a: BigNum, k: int, b: BigNum):
    if a.op == "i" and b.op == "i":
        return _exact_up_int(a.args[0], k, b.args[0])
    return None


def up(a, k: int, b) -> BigNum:
    """Knuth arrows: a ↑^k b (k arrows).  k=1 is a**b."""
    if not isinstance(k, int) or k < 1:
        raise ValueError("arrow count k must be a positive integer")
    a, b = _coerce(a), _coerce(b)

    if b.op == "i":
        n = b.args[0]
        if n < 0:
            raise ValueError("arrow height must be >= 0")
        if n == 0:
            return num(1)
        if n == 1:
            return a
        if k == 1:
            return power(a, b)
        if a.op == "i" and a.args[0] == 1:
            return num(1)
        if a.op == "i" and a.args[0] == 0:
            return num(1 if n % 2 == 0 else 0)
        if n == 2:
            # a ↑^k 2 == a ↑^(k-1) a
            return up(a, k - 1, a)

    if k == 1:
        return power(a, b)
    if a.op == "i" and a.args[0] == 1:
        return num(1)

    exact = _exact_up(a, k, b)
    if exact is not None:
        return num(exact)
    return BigNum("u", (a, b), k)


# --------------------------------------------------------------------------
# Symbolic log10 (exact transformations)
# --------------------------------------------------------------------------

def _log10_exact(n: int):
    """Return e if n == 10**e, else None."""
    s = str(n)
    if s[0] == "1" and all(c == "0" for c in s[1:]):
        return len(s) - 1
    return None


def log10(x) -> BigNum:
    """A symbolic expression for log10(x), exact by construction.

    log10(a↑^k b) uses a↑^k b == a↑^(k-1) (a↑^k (b-1)), so every step is an
    identity; `pred` keeps the b-1 exact even when b is symbolic.
    """
    x = _coerce(x)
    if x.op == "i":
        n = x.args[0]
        if n <= 0:
            raise ValueError("log10 is defined for positive numbers")
        if n == 1:
            return num(0)
        e = _log10_exact(n)
        if e is not None:
            return num(e)
        return BigNum("l", (x,))
    if x.op == "a":
        return BigNum("l", (x,))
    if x.op == "m":
        return add(*(log10(y) for y in x.args))
    if x.op == "p":
        a, b = x.args
        return mul(b, log10(a))
    if x.op == "u":
        a, b = x.args
        if x.k == 1:
            return mul(b, log10(a))
        return log10(up(a, x.k - 1, up(a, x.k, pred(b))))
    if x.op in ("l", "d"):
        return BigNum("l", (x,))
    raise TypeError(f"unknown node: {x.op}")


# --------------------------------------------------------------------------
# Float logarithm: fast magnitude estimate
# --------------------------------------------------------------------------

def _log10_int(n: int):
    if n <= 0:
        return None
    if n < (1 << 1000):
        return math.log10(n)
    s = str(n)
    L = len(s)
    lead = int(s[:16])
    return math.log10(lead) + (L - 16)


@lru_cache(maxsize=8192)
def _log10_float(x: BigNum):
    """Return log10(x) as a float, or None if x is too large/unknown.

    None specifically means "larger than about 10**308" for all the positive
    expression forms we build, which lets comparison use it as an infinity.
    """
    x = _coerce(x)
    op = x.op

    if op == "i":
        return _log10_int(x.args[0])

    if op == "l":
        v = _log10_float(x.args[0])
        if v is None or v <= 0:
            return None
        return math.log10(v)

    if op == "d":
        inner = x.args[0]
        if inner.op == "i":
            n = inner.args[0]
            return _log10_int(n - 1) if n > 1 else None
        return _log10_float(inner)

    if op == "a":
        vals = []
        for y in x.args:
            v = _log10_float(y)
            if v is None:
                return None
            vals.append(v)
        m = max(vals)
        if m > 1e300:
            return m
        try:
            s = sum(10.0 ** (v - m) for v in vals)
            return m + math.log10(s)
        except (OverflowError, ValueError):
            return m

    if op == "m":
        total = 0.0
        for y in x.args:
            v = _log10_float(y)
            if v is None:
                return None
            total += v
            if not math.isfinite(total):
                return None
        return total

    if op == "p":
        a, b = x.args
        la = _log10_float(a)
        if la is None:
            return None
        if b.op == "i":
            bb = b.args[0]
            if bb <= 0:
                return None
            try:
                v = bb * la
            except OverflowError:
                return None
            return v if math.isfinite(v) else None
        return None

    if op == "u":
        a, b = x.args
        if x.k == 1:
            return _log10_float(power(a, b))
        if b.op != "i":
            return None
        n = b.args[0]
        if n == 1:
            return _log10_float(a)
        if x.k == 2:
            # For any base >= 2, height >= 6 already has log10 > 1e308.
            if n >= 6:
                return None
            inner = up(a, 2, num(n - 1))
            li = _log10_float(inner)
            la = _log10_float(a)
            if li is None or la is None or li > 300:
                return None
            try:
                return (10.0 ** li) * la
            except OverflowError:
                return None
        return None

    return None


# --------------------------------------------------------------------------
# Comparison
# --------------------------------------------------------------------------

@lru_cache(maxsize=8192)
def _size(x: BigNum, cap: int = MAX_NODES) -> int:
    if x.op == "i":
        return 1
    total = 1
    for y in x.args:
        total += _size(y, cap)
        if total > cap:
            return cap + 1
    return total


def _short(x: BigNum, n: int = 80) -> str:
    s = str(x)
    # Collapse runs like -1)-1)-1)... and ((((((... in error messages.
    s = re.sub(r"(?:-1\)){3,}", "-1)…", s)
    s = re.sub(r"(.)\1{3,}", lambda m: m.group(1) * 2 + "…", s)
    return s if len(s) <= n else s[: n - 3] + "..."


def _dominant_term(x: BigNum):
    """Return the term that overwhelmingly dominates this positive sum."""
    logs = []
    huge = []
    for t in x.args:
        v = _log10_float(t)
        if v is None:
            huge.append(t)
        else:
            logs.append((v, t))
    if len(huge) == 1:
        return huge[0]
    if len(huge) > 1:
        return None
    if len(logs) == 1:
        return logs[0][1]
    logs.sort(key=lambda p: p[0])
    v_max, t_max = logs[-1]
    v_second, _ = logs[-2]
    return t_max if v_max > 0 and v_max > v_second + 10 else None


def _dominant_factor(x: BigNum):
    """Return the factor that overwhelmingly dominates this positive product."""
    logs = []
    huge = []
    for t in x.args:
        v = _log10_float(t)
        if v is None:
            huge.append(t)
        else:
            logs.append((v, t))
    if len(huge) == 1:
        return huge[0]
    if len(huge) > 1:
        return None
    if len(logs) == 1:
        return logs[0][1]
    total = sum(v for v, _ in logs)
    v_max, t_max = max(logs, key=lambda p: p[0])
    return t_max if v_max > 0 and v_max > total - v_max + 10 else None


def _cmp_struct(x: BigNum, y: BigNum, depth: int = 0):
    # A sum containing y as a positive summand is larger.
    if x.op == "a" and y in x.args:
        return 1
    if y.op == "a" and x in y.args:
        return -1

    # A product containing y as a factor (all factors > 1) is larger.
    if x.op == "m" and y in x.args:
        return 1
    if y.op == "m" and x in y.args:
        return -1

    # Multiset containment for sums and products.
    if x.op == y.op == "a":
        cx, cy = Counter(x.args), Counter(y.args)
        if cx != cy:
            if all(cx[k] >= v for k, v in cy.items()):
                return 1
            if all(cy[k] >= v for k, v in cx.items()):
                return -1
            # Same summands except for one term on each side.
            common = cx & cy
            rx = list((cx - common).elements())
            ry = list((cy - common).elements())
            if len(rx) == 1 and len(ry) == 1:
                return compare(rx[0], ry[0], depth + 1)

    if x.op == y.op == "m":
        cx, cy = Counter(x.args), Counter(y.args)
        if cx != cy:
            if all(cx[k] >= v for k, v in cy.items()):
                return 1
            if all(cy[k] >= v for k, v in cx.items()):
                return -1
            # Same factors except for one factor on each side.
            common = cx & cy
            rx = list((cx - common).elements())
            ry = list((cy - common).elements())
            if len(rx) == 1 and len(ry) == 1:
                return compare(rx[0], ry[0], depth + 1)

    # A sum with one overwhelmingly large term has that term's order.
    if x.op == "a" and y.op != "a":
        d = _dominant_term(x)
        if d is not None:
            return compare(d, y, depth + 1)
    if y.op == "a" and x.op != "a":
        d = _dominant_term(y)
        if d is not None:
            return compare(x, d, depth + 1)

    # Likewise for a product with one overwhelmingly large factor.
    if x.op == "m" and y.op != "m":
        d = _dominant_factor(x)
        if d is not None:
            return compare(d, y, depth + 1)
    if y.op == "m" and x.op != "m":
        d = _dominant_factor(y)
        if d is not None:
            return compare(x, d, depth + 1)

    if x.op == y.op == "u":
        a1, b1 = x.args
        a2, b2 = y.args
        if a1 == a2 and b1 == b2:
            return (x.k > y.k) - (x.k < y.k)
        if a1 == a2 and x.k == y.k:
            return compare(b1, b2, depth + 1)
        if b1 == b2 and x.k == y.k:
            return compare(a1, a2, depth + 1)
        # For equal height >= 4 and ordinary integer parameters, one extra
        # hyperoperation level dominates the base difference.  (b == 3 is a
        # counterexample: 2↑↑↑3 = 65536 < 10↑↑3.)
        if (b1 == b2 and x.k != y.k and b1.op == "i" and b1.args[0] >= 4
                and a1.op == "i" and a2.op == "i"
                and max(a1.args[0], a2.args[0]) <= 10 ** 6):
            return (x.k > y.k) - (x.k < y.k)
        # Tetration: for integer bases the base only shifts the iterated-log
        # level by a small constant, so a height lead of > 8 is decisive.
        if (x.k == y.k == 2 and b1.op == "i" and b2.op == "i"
                and a1.op == "i" and a2.op == "i"):
            h1, h2 = b1.args[0], b2.args[0]
            if h1 > h2 + 8:
                return 1
            if h2 > h1 + 8:
                return -1
        # Tetrations with different bases: the height still decides when one
        # side is astronomically taller.
        if x.k == y.k == 2 and a1 != a2:
            l1, l2 = _log10_float(b1), _log10_float(b2)
            if l1 is None and l2 is not None:
                return 1
            if l2 is None and l1 is not None:
                return -1
            if l1 is not None and l2 is not None and abs(l1 - l2) > 2:
                return 1 if l1 > l2 else -1

    if x.op == y.op == "p":
        a1, b1 = x.args
        a2, b2 = y.args
        if a1 == a2:
            return compare(b1, b2, depth + 1)
        if b1 == b2:
            return compare(a1, a2, depth + 1)

    return None


def compare(x, y, _depth: int = 0) -> int:
    """Return -1, 0 or 1.  Raise Incomparable if the order is not decidable."""
    x, y = _coerce(x), _coerce(y)
    if x == y:
        return 0

    if x.op == "i" and y.op == "i":
        a, b = x.args[0], y.args[0]
        return (a > b) - (a < b)

    # Zero and negative literals are small; symbolic nodes are positive.
    if x.op == "i" and x.args[0] <= 0:
        return -1
    if y.op == "i" and y.args[0] <= 0:
        return 1

    # (A - 1) versus B.  All values here are integer-valued.
    if x.op == "d":
        A = x.args[0]
        c = compare(A, y, _depth + 1)
        if c > 0:
            return 0 if A == add(y, num(1)) else 1
        return -1
    if y.op == "d":
        A = y.args[0]
        c = compare(x, A, _depth + 1)
        if c < 0:
            return 0 if add(x, num(1)) == A else -1
        return 1

    # log10 is strictly increasing, so compare arguments.
    if x.op == "l" and y.op == "l":
        return compare(x.args[0], y.args[0], _depth + 1)

    c = _cmp_struct(x, y, _depth)
    if c is not None:
        return c

    lx, ly = _log10_float(x), _log10_float(y)
    if lx is not None and ly is not None:
        if math.isfinite(lx) and math.isfinite(ly):
            margin = 1e-9 * max(1.0, abs(lx), abs(ly))
            if lx < ly - margin:
                return -1
            if lx > ly + margin:
                return 1
            # Too close for float; fall through to symbolic logs.
    elif lx is None and ly is not None:
        return 1
    elif ly is None and lx is not None:
        return -1

    if _depth > MAX_LOG_DEPTH:
        raise Incomparable(f"cannot compare {_short(x)} and {_short(y)}")

    if x.op == y.op == "a":
        raise Incomparable(f"cannot compare sums {_short(x)} and {_short(y)}")
    if x.op == y.op == "m":
        raise Incomparable(f"cannot compare products {_short(x)} and {_short(y)}")

    if _size(x) + _size(y) > MAX_NODES:
        raise Incomparable(f"cannot compare {_short(x)} and {_short(y)}")

    lx2, ly2 = log10(x), log10(y)
    if lx2 == ly2:
        return 0
    if lx2 == BigNum("l", (x,)) or ly2 == BigNum("l", (y,)):
        raise Incomparable(f"cannot compare {_short(x)} and {_short(y)}")
    return compare(lx2, ly2, _depth + 1)


# --------------------------------------------------------------------------
# Short decimal output: only `prec` significant digits
# --------------------------------------------------------------------------

def _sci_int(n: int, prec: int) -> str:
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) <= prec:
        return sign + s
    if prec == 1:
        return f"{sign}{s[0]}e{len(s) - 1}"
    return f"{sign}{s[0]}.{s[1:prec]}e{len(s) - 1}"


def sci(x, prec: int = 2, _depth: int = 0) -> str:
    """Short approximate form using at most `prec` significant digits.

    Exact integers become ordinary scientific notation.  Values whose
    log10 fits in a float become ``m...e<exp>``.  Tetrations become a short
    power tower; anything higher stays in arrow notation.
    """
    x = _coerce(x)
    prec = max(1, int(prec))

    if x.op == "i":
        return _sci_int(x.args[0], prec)

    l = _log10_float(x)
    if l is not None and math.isfinite(l) and l < 1e15:
        e = math.floor(l)
        m = 10.0 ** (l - e)
        if m >= 10.0 - 0.5 * 10 ** (-(prec - 1)):
            m /= 10.0
            e += 1
        if prec == 1:
            return f"{m:.0f}e{int(e)}"
        return f"{m:.{prec - 1}f}e{int(e)}"

    if _depth < 12:
        if x.op == "p":
            a, b = x.args
            return f"{sci(a, prec, _depth + 1)}^({sci(b, prec, _depth + 1)})"
        if x.op == "u" and x.k == 2 and x.args[1].op == "i":
            a, b = x.args
            n = b.args[0]
            if 1 <= n <= 12:
                if n == 1:
                    return sci(a, prec, _depth + 1)
                inner = up(a, 2, num(n - 1))
                return f"{sci(a, prec, _depth + 1)}^({sci(inner, prec, _depth + 1)})"

    return str(x)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

_PREC = {"a": 1, "m": 2, "p": 3, "u": 4, "i": 9, "l": 9, "d": 9}


def _operand(x: BigNum, min_prec: int) -> str:
    s = _render(x)
    return f"({s})" if _PREC.get(x.op, 9) < min_prec else s


def _render(x: BigNum) -> str:
    op = x.op
    if op == "i":
        return str(x.args[0])
    if op == "a":
        return " + ".join(_operand(y, 1) for y in x.args)
    if op == "m":
        return "*".join(_operand(y, 2) for y in x.args)
    if op == "p":
        a, b = x.args
        return f"{_operand(a, 5)}^{_operand(b, 5)}"
    if op == "u":
        a, b = x.args
        return f"{_operand(a, 5)}{'↑' * x.k}{_operand(b, 5)}"
    if op == "l":
        return f"log({_render(x.args[0])})"
    if op == "d":
        return f"({_render(x.args[0])}-1)"
    return f"{op}{x.args}"
