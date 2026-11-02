<div align="center">

# dsh-store-replenish

> **官方仓库。** 本包唯一官方仓库，由 PerryLink 维护；其他账号下的同名仓库与本项目无关。Apache-2.0。

[![npm](https://img.shields.io/npm/v/dsh-store-replenish)](https://www.npmjs.com/package/dsh-store-replenish)
[![CI](https://github.com/PerryLink/dsh-store-replenish/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-store-replenish/actions)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**把门店-商品销售库存表变成按 SKU 的补货建议、按门店汇总的补货单和补货 CSV。**

> **状态：alpha / 公开合成 / partial / not counted / 非 GA。** 不含门店数据、商品数据或销售证据，也不作生产可用、采购或财务结论声明。

[English](README.md) · [简体中文](README-zh.md)

```sh
dsh plugin --profile <profile> add dsh-store-replenish
```

</div>

## 一句话

用 `日均销量 × (补货周期 + 安全天数) − 当前库存 − 在途` 算出目标缺口，再向上取整到起订量（MOQ），给出每个门店-SKU 的建议补货量；同时标出周转超过 60 天的滞销 SKU，以及库存撑不到下次到货的缺货风险。

## 适合 / 不适合

- **适合**：几十到几千个门店-SKU 组合的日常补货；需要把“日均销量、当前库存、在途、安全天数、补货周期、起订量”固定成一套可复核的算法；需要按门店汇总 SKU 数、总件数和预估金额；需要先看缺货风险再决定补货顺序；需要把补货单交给店长、采购或仓库复核。
- **不适合**：自动下采购单、自动调拨或对接 ERP / POS / WMS；多仓、多币种、税率或含税价换算；促销、季节、保质期、批次或效期建模；EOQ、持有成本、服务水平或安全库存优化（安全天数由你输入）；直接读 Excel / PDF / 图片（请先导出成 CSV）；把建议当成采购承诺。

## 输入

- 格式：UTF-8 CSV，首行表头，逗号分隔；支持 RFC 4180 引号、嵌入换行、CRLF 与 BOM。
- 表头：`store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents`。也接受 `门店 / SKU / 品名 / 销量 / 当前库存 / 在途 / 安全天数 / 补货周期天数 / 起订量 / 单价分` 等中文别名；`name`（品名）可省略，省略时用 SKU 代替；多出的列会被忽略。
- 销量：`sales_qty` 是**统计窗口内**的累计销量，单位与库存一致（件/瓶/包）。窗口由工具的 `window_days` 声明，默认 30 天。
- 数值：销量、当前库存、在途、安全天数、补货周期天数、起订量、单价分都必须是**非负整数**；起订量至少 1；安全天数与补货周期天数上限 3650；单价是整数**分**。负数、小数、空值或超范围一律 `E_REPL_QTY`。
- 门店-SKU：同一文件内 `(门店, SKU)` 不能重复；不同门店可以卖同一个 SKU。
- 大小：单个文件 ≤ 20 MB；超过请按门店或品类拆文件。
- 来源：用户自己指定的本地 CSV；原文件只读，不会被修改。

## 输出

- **`replenish.suggest`**：`{ window_days, source_sha256, totals, items }`。每个 SKU 有日均销量、可用天数、周转天数、目标量、缺口、建议补货量、预估金额，以及 `slow_moving`、`stockout_risk`、`stockout_now` 三个标记。`items` 按门店、风险、建议量、SKU 稳定排序。
- **`replenish.plan`**：`{ window_days, source_sha256, totals, stores }`。按门店汇总 `sku_count`（该店 SKU 数）、`order_lines`（需要补货的 SKU 数）、`total_units`（总件数）、`estimated_value_cents`（预估金额分）、缺货风险数、滞销数、`risk_level`（high/medium/low）；门店按缺货风险排序，并保留每个 SKU 的明细。
- **`replenish.export`**：把补货单写成 CSV 到 `$DSH_HOME/dsh-store-replenish/exports/`，列固定为 `门店,SKU,品名,当前库存,在途,日均销量,补货周期天数,安全天数,建议补货量,预估金额,缺货风险,滞销,周转天数`；返回路径、`sha256`、字节数和行数。默认只导出建议量 > 0 的 SKU；`include_zero=true` 时追加其余 SKU，便于复核“为什么没补”。

## 规则

1. 日均销量 = `sales_qty / window_days`；`window_days` 默认 30，允许 1–3650。它声明 CSV 里的销量代表多少天，不会自动去查历史。
2. 目标库存 = `日均销量 × (cycle_days + safety_days)`。
3. 缺口 = `目标库存 − 当前库存 − 在途`；在途计入可用库存。
4. 建议补货量 = 缺口 ≤ 0 时取 0；否则 `ceil(缺口 / moq) × moq`。MOQ 取整用整数分子/分母计算，避免浮点误差把正好整倍的情形多推一档。
5. 周转天数 = `当前库存 / 日均销量`；库存 > 0 且周转 > 60 天标为滞销。无销量但有库存时周转为 `null`（视为无穷大），同样标滞销；无销量且无库存不标。
6. 缺货风险 = `当前库存 + 在途 < 日均销量 × cycle_days`，即现有可用库存撑不到下一次补货到货。当前库存为 0 且日均 > 0 时另有 `stockout_now=true`。
7. 门店排序：`stockout_now` 数降序 → 缺货风险数降序 → 预估金额降序 → 门店名升序。缺货风险优先于金额，所以金额更小的门店也可能排在前面。
8. 门店内排序：`stockout_now` → 缺货风险 → 需要补货 → 滞销 → 其他；同档按建议量降序、SKU 升序。
9. 预估金额 = `建议补货量 × 单价分`；CSV 里格式化为两位小数，API 里仍是整数分。
10. `replenish.export` 默认只写建议量 > 0 的 SKU；若一行都没有则报 `E_REPL_EMPTY`，传 `include_zero=true` 可导出全量 SKU（此时建议量为 0 的行也写入，`order_lines` 仍只数建议量 > 0 的行）。

## 示例

直接复制下面这句：

> 用这份 2 门店 × 8 SKU 的销售库存表，按 30 天窗口算补货建议，汇总成门店补货单并导出补货 CSV。

用自带样例复跑并核对金标：

```sh
node samples/quickstart/run.mjs --check
```

![dsh-store-replenish quickstart 真实运行输出](docs/assets/quickstart.png)

样例是 16 行合成数据（2 家门店 × 8 个 SKU），含 1 个滞销 SKU（成都高新店 `抑菌洗手液 500ml`，周转 100 天）和 2 个缺货风险 SKU（上海静安店 `苏打饼干 400g`、`鲜牛奶 950ml`）。样例同时覆盖 MOQ 正好整倍（`每日坚果` 12 → 12）与非整倍（`苏打饼干` 70 → 72）、缺口正好为 0（上海 `成猫粮`）和完全无销量（成都 `抑菌洗手液`）。金标 `samples/quickstart/expected/result.json` 由 `node samples/quickstart/run.mjs --json` 真实产生，不是手写；截图是 `--check` 的真实终端输出。

## 权限

读：用户指定的门店-商品销售库存 CSV（样例 `samples/quickstart/input/store-replenish.csv`）；不读其他目录。
写：`$DSH_HOME/dsh-store-replenish/exports/`（补货单 CSV）；不改原 CSV。
联网：否。
外部系统：无。

`replenish.suggest` 和 `replenish.plan` 标 **R0**（只读）；`replenish.export` 标 **R1**（本地写，只写 `exports/`）。测试可用 `DSH_STORE_REPLENISH_HOME` 覆盖本地写根目录，默认严格等于 `$DSH_HOME/dsh-store-replenish`。

## FAQ

### 1. 为什么建议量和手工算的差一箱？

因为向上取整到起订量。例如缺口 70、起订量 24，`ceil(70/24)=3`，建议 72 而不是 70。看 `raw_qty`（缺口）和 `moq` 就能对出来；`suggested_qty` 一定是 MOQ 的整数倍。

### 2. 滞销 SKU 还会建议补货吗？

公式优先：如果缺口 > 0，仍会给出建议，同时 `slow_moving=true` 提醒你先处理库存。实际业务里通常先核对滞销原因；本包只标记，不自动把滞销 SKU 归零，也不替你做停采决定。

### 3. `window_days` 是“最近 N 天”自动取数吗？

不是。它声明 CSV 里 `sales_qty` 代表多少天的累计销量。传 15 就是把同一列解释成 15 天销量，日均会相应变大。工具不会去读历史数据或调用任何系统。

### 4. 在途算库存吗？算周转吗？

在途计入可用库存（公式里减掉，也参与缺货风险判断），但**不计入周转天数**。周转只看当前库存与日均销量。

### 5. `stockout_risk` 和 `stockout_now` 有什么区别？

`stockout_now` 表示当前库存已经是 0 且仍有销量；`stockout_risk` 表示当前库存 + 在途撑不到下次补货到货（`< 日均 × cycle_days`）。在途很多时可能 `stockout_now=true` 但 `stockout_risk=false`。

### 6. 会改我的文件或上传数据吗？

不会。只读用户指定的 CSV；只在本地写 `$DSH_HOME/dsh-store-replenish/exports/`；不联网、不调用模型、不上传。原 CSV 不会被改写。

### 7. 能直接读 Excel 或对接采购系统吗？

不能。只接受 CSV，不生成采购订单、不调用 ERP/POS/WMS、不发送任何消息。需要下单时，把导出的 CSV 交给现有流程并人工复核。

## 版本

`0.1.0-alpha.1` · 121 项测试通过（`node --test test/*.test.mjs`）。

> ⭐ 如果它帮到了你，点个 star 会让下一个人更容易找到它；没有任何功能被 star 解锁。

## 安装

```sh
dsh plugin --profile <profile> add dsh-store-replenish
dsh --profile <profile> --dump-config | grep dsh-store-replenish
```

卸载：

```sh
dsh plugin --profile <profile> remove dsh-store-replenish
```

### 安装通道

- **npm（推荐）：** `dsh plugin --profile <profile> add dsh-store-replenish`
- **git 通道：** `dsh plugin --profile <profile> add github:PerryLink/dsh-store-replenish`
- **tarball：** `pnpm pack`，然后 `dsh plugin --profile <profile> add ./dsh-store-replenish-<version>.tgz`

## 工具

工具名是稳定 API；说明保留英文以匹配运行时输出。

| 工具 | 用途 | 风险 |
|---|---|---|
| `replenish.suggest` | 读取门店-SKU CSV，按日均销量、补货周期、安全天数、库存、在途和 MOQ 算每个 SKU 的建议补货量，并标记滞销与缺货风险 | R0 |
| `replenish.plan` | 按门店汇总补货单（SKU 数、补货行数、总件数、预估金额、风险数），按缺货风险排序 | R0 |
| `replenish.export` | 导出补货单 CSV（门店/SKU/品名/库存/在途/日均/周期/安全天数/建议量/金额/风险/滞销/周转），返回路径与 sha256 | R1 本地写 |

## 错误码

| 错误码 | 何时出现 | 下一步 |
|---|---|---|
| `E_REPL_QTY` | 销量/库存/在途/安全天数/补货周期/起订量/单价为负数、小数、空值、超范围；起订量为 0；`window_days` 不在 1–3650 | 所有数值填非负整数，起订量至少 1，窗口 1–3650 |
| `E_REPL_CSV_ROW` | 列数不对、表头缺失或重复、门店/SKU 为空、同一门店-SKU 重复、文件超过 20 MB | 对照表头修这一行；`(门店, SKU)` 只能出现一次 |
| `E_REPL_EMPTY` | CSV 为空/只有表头；导出时没有任何建议量 > 0 的 SKU | 确认 CSV 有数据行；要看全量 SKU 时传 `include_zero=true` |
| `E_REPL_PATH_INVALID` | 输入路径不存在/是目录/读不了，导出文件名含路径、空格、中文或超长，或写文件失败 | 传存在的 CSV；导出只传 `[A-Za-z0-9._-]` 文件名 |

报错原文格式：`<一句人话>（E_REPL_XXX）｜下一步：<一个动作>`。更多排查见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

## 验收证据

公开/合成 fixture 在 `samples/quickstart/`；`ACCEPTANCE.csv` 记录 15 项工具检查 + 1 项 quickstart 金标，除 quickstart 行外均为 `counted=false`。

| req_id | metric | threshold | actual | pass | source | counted |
|---|---|---|---|---|---|---|
| AC-R01 | suggest totals | rows=16 order_lines=11 units=398 | rows=16 order_lines=11 units=398 | true | public/synthetic | false |
| AC-R02 | MOQ rounding | 苏打=72 牛奶=60 | 苏打=72 牛奶=60 | true | public/synthetic | false |
| AC-R03 | flags | risk=2 slow=1 | risk=2 slow=1 | true | public/synthetic | false |
| AC-R04 | store aggregation | 上海=282 成都=116 | 上海=282 成都=116 | true | public/synthetic | false |
| AC-R07 | replenishment CSV | rows=11 lines=12 | rows=11 lines=12 | true | public/synthetic | false |
| AC-R09 | 15-day window | order_lines=14 units=1774 | order_lines=14 units=1774 | true | public/synthetic | false |
| PS1-QS01 | quickstart golden | 1/1 | 1 | true | synthetic/quickstart | true |

*这是 fixture 支撑的验收行，不是门店运行；没有编造输出。*

## 边界与已知限制

- **不下单、不调拨**：只给建议和本地 CSV；不接采购、ERP、POS、WMS，不发送任何消息。
- **单仓单币种**：输入没有仓库、币种或税率列；多仓/多币种请拆文件或在源系统折算。
- **安全天数由你给**：不做需求预测、季节性、促销、服务水平或 EOQ 优化；安全天数与补货周期是输入，不是模型输出。
- **不做效期/批次**：不建模保质期、批次、序列号、先进先出或损耗。
- **销量窗口是声明的**：`sales_qty` 代表 `window_days` 天的累计销量；工具不会自动取历史数据。
- **周转是标记不是决策**：滞销只按 60 天阈值标记；是否停采、清仓或退货由你决定。
- CSV only：不读 Excel / PDF / 图片，不做 OCR。
- 导出 CSV 只做 RFC 4180 引号转义，不做 Excel 公式前缀清洗；不要用 Excel 直接打开来源不明的 CSV。
- 数值按整数件与整数分处理；不处理拆零、称重或小数计量。
- 仅公开/合成样例；alpha/partial、not counted，不作 GA 或生产可用声明。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck
node --test test/*.test.mjs
node scripts/gate.mjs
```

## 兼容性

| 维度 | 状态 |
|---|---|
| Harness | `dsh >=0.2.1-rc.3 <0.4.0` |
| Node | `>=24.9.0 <25` |
| Platforms | All; local files only |
| 数据 | No network, no model call, no upload |

## 相关项目

- [dsh-pim-lint](https://github.com/PerryLink/dsh-pim-lint)（商品主数据校验）
- [dsh-pim-listing](https://github.com/PerryLink/dsh-pim-listing)（商品上架检查）
- [领域索引](https://perrylink.github.io/dsh-plugins/)

## 许可证

Apache-2.0. See `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES`.
