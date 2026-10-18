"""Run `python demo.py` to see the library in action."""

from bignumber import Incomparable, compare, log10, num, sci, up

x = up(10, 7, 10)

print("x              =", x)
print("sci(x, 2)      =", sci(x, 2))
print("x + 1          =", x + 1)
print("x * 2          =", x * 2)
print("log10(x)       =", log10(x))
print()
print("x > 10↑↑↑↑↑↑10  =", x > up(10, 6, 10))
print("x > 10↑↑↑↑↑↑↑9  =", x > up(10, 7, 9))
print("x > 10↑↑↑↑↑↑9   =", x > up(10, 6, 9))
print("x > 3↑↑↑↑↑↑↑↑10 =", x > up(3, 8, 10))
print("x > 2↑¹⁰⁰10     =", x > up(2, 100, 10))
print("x > 10^100000   =", x > num(10 ** 100000))
print()
print("3↑↑3           =", up(3, 2, 3), "->", sci(up(3, 2, 3)))
print("10↑↑3          =", up(10, 2, 3), "->", sci(up(10, 2, 3)))
print("10↑↑4          =", up(10, 2, 4), "->", sci(up(10, 2, 4)))
print("10↑↑10         =", sci(up(10, 2, 10)))
print()
print("10↑↑3 == 10^(10^10) ->", compare(up(10, 2, 3), num(10) ** (num(10) ** num(10))) == 0)

try:
    compare(up(10, 3, 3), up(2, 3, 100))
except Incomparable as exc:
    print("Incomparable:", exc)
