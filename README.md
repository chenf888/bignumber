# bignumber

一个**零依赖**的符号大数库，支持 Knuth 高德纳箭头。提供两个行为对齐的单文件实现：

- **JavaScript (ES Module)**：`bignumber.js`
- **Python**：`bignumber.py`

目标数可以直接构造：

```js
import { up, sci } from "./bignumber.js";

const x = up(10, 7, 10);   // 10 ↑↑↑↑↑↑↑ 10
console.log(String(x));    // 10↑↑↑↑↑↑↑10
console.log(sci(x));       // 10↑↑↑↑↑↑↑10
```

```python
from bignumber import up, sci

x = up(10, 7, 10)
print(x)                   # 10↑↑↑↑↑↑↑10
print(sci(x))              # 10↑↑↑↑↑↑↑10
```

核心思路：**不把数算出来**。值以规范化表达式树保存；只有当结果能装进
`EVAL_BITS`（默认 65536 位，约 19700 位十进制）时才真的算成整数。其余情况
保持符号形式，因此 `10↑↑↑↑↑↑↑10` 这种数可以瞬间构造、比较和打印。

近似输出默认只保留 **2 位有效数字**：

```js
sci(up(3, 2, 3))        // "7.6e12"      ← 7625597484987，只算 2 位
sci(up(10, 2, 3))       // "1.0e10000000000"
sci(up(10, 2, 4))       // "10^(1.0e10000000000)"
```

```python
sci(up(3, 2, 3))        # '7.6e12'
sci(up(10, 2, 3))       # '1.0e10000000000'
sci(up(10, 2, 4))       # '10^(1.0e10000000000)'
```

---

## 增量游戏：超指数工厂

基于 `bignumber.js` 的网页增量游戏。点击采集能量，用核心购买高度和反应堆，
再逐级解锁高德纳箭头，最终把产能推到 `10↑↑↑↑↑↑↑10`。

![游戏界面](./game-screenshot.png)

```bash
npm start
# 打开 http://localhost:8080
```

也可以直接运行 `node server.js`，或用任意静态服务器托管项目目录。游戏是
纯前端 ES Module，不需要构建步骤。

**玩法**

- **采集能量**：每次点击获得 `1 + 箭头数` 个脉冲和核心。
- **高度**：提升产能公式里的指数/箭头参数，是最基础的成长。
- **反应堆**：每级让产能乘以 2，同时把 1 级计入高度参数。
- **维度跃迁**：消耗核心并满足能量条件后，箭头数 +1。0 个箭头是乘法，
  1 个是指数，2 个是四则超运算，依此类推，最多 7 个箭头。
- **终极目标**：7 个箭头且高度 + 反应堆 ≥ 10，让产能越过
  `10↑↑↑↑↑↑↑10`。
- 游戏自动保存在 `localStorage`，关闭页面后回来会结算最多 8 小时离线收益；
  右上角可以开启自动升级。

**实现要点**

- 能量不反复累加，而是始终表示为 `产能 × 累计脉冲`。这样即使产能已经是
  `10↑↑↑↑↑↑↑41`，能量也只是一个乘积节点，不会产生巨大的求和树。
- 产能用 `up(10, k, height + reactor)` 构造；只有当结果能装进
  `EVAL_BITS` 时才精确计算，否则保持箭头表达式。
- 跃迁条件直接比较「能量」和「同底数、同箭头数的阈值」，例如
  `10↑↑↑↑↑↑↑12 × 2048` 与 `10↑↑↑↑↑↑↑10`，比较只涉及箭头高度，稳定且快。
- 核心和升级等级保持普通 JS 整数，避免把游戏经济也符号化。

游戏文件：`game.html`、`game.css`、`game.js`、`server.js`。

---

## JavaScript 版

需要 Node.js 18+（使用原生 `BigInt` 和 ES Module）。

```bash
node demo.js
npm test          # 或 node --test
```

### API

| 函数 | 含义 |
| --- | --- |
| `num(n)` | 把 `BigInt` / 安全整数 / 整数字符串包成 `BigNum` |
| `add(...xs)` / `mul(...xs)` | 加法 / 乘法（自动合并、排序） |
| `pow(a, b)` | `a ** b`，能算则算，否则符号化 |
| `up(a, k, b)` | `a ↑^k b`，`k` 是箭头个数；`k=1` 就是乘方 |
| `pred(x)` | `x - 1`，符号化时保留为 `d` 节点 |
| `log10(x)` | 精确符号对数，内部用于比较和约简 |
| `compare(x, y)` | 返回 `-1/0/1`；无法判定时抛 `Incomparable` |
| `sci(x, prec=2)` | 短科学计数法 / 幂塔 / 箭头表示，默认 2 位有效数字 |
| `toBigInt(x)` | 精确整数时返回 `BigInt`，否则抛 `OverflowError` |

`BigNum` 还提供方法：`x.add(y)`、`x.mul(y)`、`x.pow(y)`、`x.cmp(y)`、
`x.toBigInt()`、`x.toString()`。

**JS 不能重载运算符**，所以不要写 `x + 1`、`x * 2`、`x > y`。请使用：

```js
import { add, mul, compare, up } from "./bignumber.js";

const x = up(10, 7, 10);
console.log(String(add(x, 1)));        // 10↑↑↑↑↑↑↑10 + 1
console.log(String(mul(x, 2)));        // 10↑↑↑↑↑↑↑10*2
console.log(compare(x, up(10, 6, 10))); // 1
console.log(x.cmp(up(10, 6, 10)) > 0);  // true
```

为了尽早发现误用，`x + 1` 会抛出一个带提示的 `TypeError`。

### 比较与限制

- 精确整数直接比较。
- 同底数、同箭头数：比较箭头数或高度。
- 结构相同（和、积、幂）时逐项比较。
- 其余情况反复取符号 `log10`。因为 `log10(a↑^k b)` 可以精确地写成更低
  一阶的箭头表达式，比较会逐层下降；同时带节点数和深度上限，避免大数
  展开失控。
- 实在判不了就抛 `Incomparable`，而不是给出错误答案。

已知限制：不同底数、不同箭头数且高度也不同的“怪物级”箭头，比较可能
无法判定。例如 `10↑↑↑3` 与 `2↑↑↑100` 会抛 `Incomparable`。常规场景
（同底数、同高度、常见小底数）都能判定。

---

## Python 版

```bash
python demo.py
python -m unittest -v test_bignumber
```

### API

| 函数 | 含义 |
| --- | --- |
| `num(n)` | 把 Python 整数包成 `BigNum` |
| `add(a, b, ...)` / `mul(a, b, ...)` | 加法 / 乘法（自动合并、排序） |
| `power(a, b)` | `a ** b`，能算则算，否则符号化 |
| `up(a, k, b)` | `a ↑^k b`，`k` 是箭头个数；`k=1` 就是乘方 |
| `pred(x)` | `x - 1`，符号化时保留为 `d` 节点 |
| `log10(x)` | 精确符号对数，内部用于比较和约简 |
| `compare(x, y)` | 返回 `-1/0/1`；无法判定时抛 `Incomparable` |
| `sci(x, prec=2)` | 短科学计数法 / 幂塔 / 箭头表示，默认 2 位有效数字 |

`BigNum` 支持 `+`、`*`、`**`、`<`、`<=`、`>`、`>=` 和 `str()`。
`int(x)` 只在值恰好是精确整数时返回 Python `int`，否则抛 `OverflowError`。

```python
from bignumber import add, mul, up

x = up(10, 7, 10)
assert x > up(10, 6, 10)
assert x > up(10, 7, 9)
assert x > up(10, 6, 9)
assert x > 10 ** 100000
```

Python 导入时会调用 `sys.set_int_max_str_digits(0)`，解除 Python 3.11+
对超长整数字符串转换的 4300 位限制。

---

## 说明

- 只支持非负整数叶子。负数、浮点数不在设计范围内。
- `EVAL_BITS` 可以按需调大/调小。调小更省内存，调大能精确算更多中间值。
- JS 版用 `Map` 对表达式节点做 intern（相同结构共享同一个对象），因此
  `===` 就是结构相等，`Map`/`Set` 也能直接当计数器用。
