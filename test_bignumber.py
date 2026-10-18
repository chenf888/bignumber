import unittest

from bignumber import (
    Incomparable,
    add,
    compare,
    log10,
    mul,
    num,
    power,
    pred,
    sci,
    up,
)


class ExactTests(unittest.TestCase):
    def test_small_arithmetic(self):
        self.assertEqual(add(num(2), num(3)), num(5))
        self.assertEqual(mul(num(2), num(3)), num(6))
        self.assertEqual(power(2, 10), num(1024))
        self.assertEqual(up(10, 1, 3), num(1000))

    def test_tetration_that_fits(self):
        self.assertEqual(up(2, 2, 4), num(65536))
        self.assertEqual(up(3, 2, 3), num(3 ** 27))

    def test_canonical_forms(self):
        x = up(10, 7, 10)
        self.assertEqual(str(x + 1), "10↑↑↑↑↑↑↑10 + 1")
        self.assertEqual(str(x * 2), "10↑↑↑↑↑↑↑10*2")
        self.assertEqual(x + 1, add(1, x))
        self.assertEqual(x * 2, mul(2, x))

    def test_int_conversion(self):
        self.assertEqual(int(up(2, 2, 4)), 65536)
        with self.assertRaises(OverflowError):
            int(up(10, 7, 10))


class SymbolicTests(unittest.TestCase):
    def test_target_number(self):
        x = up(10, 7, 10)
        self.assertEqual(str(x), "10↑↑↑↑↑↑↑10")
        self.assertEqual(x.k, 7)
        self.assertEqual(str(up(10, 2, 3)), "10↑↑3")

    def test_same_value_different_shape(self):
        # 10↑↑3 == 10^(10^10)
        a = up(10, 2, 3)
        b = power(10, power(10, 10))
        self.assertEqual(compare(a, b), 0)

    def test_log_is_exact(self):
        # log10(10↑↑4) == 10↑↑3
        self.assertEqual(log10(up(10, 2, 4)), up(10, 2, 3))
        # log10(10↑↑↑3) == 10↑↑(10↑↑10 - 1)
        lhs = log10(up(10, 3, 3))
        rhs = up(10, 2, pred(up(10, 2, 10)))
        self.assertEqual(lhs, rhs)


class CompareTests(unittest.TestCase):
    def test_arrow_monotonicity(self):
        x = up(10, 7, 10)
        self.assertGreater(x, up(10, 6, 10))
        self.assertGreater(x, up(10, 7, 9))
        self.assertGreater(x, up(10, 6, 9))

    def test_tetration(self):
        self.assertGreater(up(10, 2, 4), up(10, 2, 3))
        self.assertGreater(up(10, 2, 3), num(10 ** 100))
        self.assertGreater(up(10, 2, 3), power(10, 10 ** 9))

    def test_mixed_bases(self):
        # 2↑↑5 = 2^65536 is just above 10^19728.
        self.assertGreater(up(2, 2, 5), num(10 ** 19728))
        self.assertLess(up(2, 2, 5), num(10 ** 19729))
        self.assertLess(up(2, 2, 5), num(10 ** 100000))

    def test_cross_base_arrows(self):
        # One extra level dominates a small base difference at height 10.
        self.assertLess(up(10, 7, 10), up(3, 8, 10))
        self.assertLess(up(10, 7, 10), up(2, 100, 10))
        # Tetration height is decisive when the lead is large.
        self.assertGreater(up(2, 2, 100), up(10, 2, 10))
        self.assertGreater(up(2, 2, 20), up(10 ** 6, 2, 4))
        self.assertLess(up(2, 2, 5), up(10, 2, 3))
        self.assertGreater(up(2, 2, 6), up(10, 2, 3))

    def test_huge_vs_literal(self):
        self.assertGreater(up(10, 7, 10), num(10 ** 100000))
        self.assertLess(num(10 ** 100000), up(10, 7, 10))

    def test_symbolic_arithmetic_order(self):
        x = up(10, 7, 10)
        self.assertGreater(x + 1, x)
        self.assertGreater(x * 2, x)

    def test_incomparable_is_explicit(self):
        # Common terms can be cancelled; two unrelated huge sums cannot.
        x = add(up(10, 3, 3), num(1))
        y = add(up(10, 3, 4), num(1))
        self.assertGreater(y, x)

        a = add(up(10, 3, 3), up(10, 2, 10))
        b = add(up(10, 3, 4), up(10, 2, 9))
        with self.assertRaises(Incomparable):
            compare(a, b)


class SciTests(unittest.TestCase):
    def test_two_digits(self):
        self.assertEqual(sci(num(7625597484987), 2), "7.6e12")
        self.assertEqual(sci(num(123), 2), "1.2e2")
        self.assertEqual(sci(num(12), 2), "12")

    def test_tetration(self):
        self.assertEqual(sci(up(10, 2, 3), 2), "1.0e10000000000")
        self.assertEqual(sci(up(10, 2, 4), 2), "10^(1.0e10000000000)")

    def test_target_stays_symbolic(self):
        self.assertEqual(sci(up(10, 7, 10), 2), "10↑↑↑↑↑↑↑10")

    def test_precision(self):
        self.assertEqual(sci(num(123456), 3), "1.23e5")


if __name__ == "__main__":
    unittest.main()
