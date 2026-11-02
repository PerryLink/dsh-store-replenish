# 故障排查 — dsh-store-replenish

每条按「症状 / 原因 / 动作」写。报错原文都是 `<一句人话>（E_REPL_XXX）｜下一步：<动作>`，
把 `E_REPL_XXX` 和这句话一起发到 issue 即可定位。不要把真实门店、商品或销售明细贴进 issue。

## 1. 数量填了负数或小数（E_REPL_QTY）

- **症状**：`数量、天数、起订量或单价不是非负整数，或起订量为 0（E_REPL_QTY）｜下一步：把销量/库存/在途/安全天数/补货周期/起订量/单价都填成整数，起订量至少 1｜细节：第 7 行当前库存："-3" 不是非负整数`
- **原因**：库存盘点差异被写成负数、销量填了 `12.5`、单价填了元而不是分，或空单元格被当成数字。
- **动作**：按报错行号把该列改成非负整数；库存差异先在源系统调账，不要用负数表示；单价统一填整数**分**（12.90 元 → 1290）。改完重跑 `replenish.suggest`。

## 2. 起订量、天数或窗口越界（E_REPL_QTY）

- **症状**：`...E_REPL_QTY...｜细节：第 3 行起订量：0 不在 1–1000000 范围内`，或 `统计窗口 window_days 必须是 1–3650 的整数，收到 0`
- **原因**：起订量为 0 或空；安全天数/补货周期超过 3650；`window_days` 传了 0、负数、小数或超过 3650。
- **动作**：起订量填 ≥ 1 的整数；安全天数与补货周期填 0–3650；`window_days` 填 1–3650（默认 30）。确认 CSV 里的销量确实是这个窗口的累计值。

## 3. 表头缺列或重复（E_REPL_CSV_ROW）

- **症状**：`补货 CSV 有一行读不了：表头、列数或门店-SKU 不合规（E_REPL_CSV_ROW）｜下一步：对照表头检查这一行...｜细节：表头缺少：当前库存`
- **原因**：表头用了别的列名、漏了一列，或同一列出现两次（例如 `stock_qty` 与 `当前库存` 同时存在）；`name` 是唯一可省略的列。
- **动作**：把表头改成 `store,sku,name,sales_qty,stock_qty,in_transit,safety_days,cycle_days,moq,unit_price_cents`（或对应中文别名），每列只留一次。确认后重跑。

## 4. 列数不对、门店或 SKU 为空（E_REPL_CSV_ROW）

- **症状**：`...E_REPL_CSV_ROW...｜细节：第 9 行有 9 列，表头有 10 列`，或 `第 4 行 SKU 为空`
- **原因**：某行少了一个逗号、字段没填，或引号没有闭合把后面的行吞掉了；也可能是门店/SKU 列留空。
- **动作**：按报错行号补成与表头相同的列数；字段本身含逗号时用双引号包住（例如 `"上海, 静安店"`）；门店与 SKU 不能为空。改完重跑。

## 5. 同一门店-SKU 重复（E_REPL_CSV_ROW）

- **症状**：`...E_REPL_CSV_ROW...｜细节：第 11 行门店 上海静安店 的 SKU SKU-SN-001 重复`
- **原因**：同一门店同一商品被导出了两次（例如两个品类表合并），或 SKU 编码在不同品类下重复使用。
- **动作**：在源系统按 `(门店, SKU)` 去重；如果确实是两个不同商品，先给它们不同的 SKU 编码。不同门店可以卖同一个 SKU，本包允许。

## 6. CSV 是空的或只有表头（E_REPL_EMPTY）

- **症状**：`没有可用的补货数据：表是空的，或没有需要补货的 SKU（E_REPL_EMPTY）｜下一步：确认 CSV 有数据行；只想看全部 SKU 时传 include_zero=true｜细节：只有表头，没有数据行`
- **原因**：导出的文件没有数据行、被清空，或只保留了表头。
- **动作**：确认导出的 CSV 至少有一行数据；空文件也会在读取阶段报同一个码。不要用删行来“修复”数据，先回源系统重新导出。

## 7. 导出时没有可写的补货行（E_REPL_EMPTY）

- **症状**：`...E_REPL_EMPTY...｜细节：没有需要补货的 SKU；要导出全部 SKU 请传 include_zero=true`
- **原因**：所有 SKU 的库存加在途都已覆盖目标库存（建议量为 0），默认导出只写建议量 > 0 的行。
- **动作**：用 `replenish.plan` 看 `order_lines` 是否为 0；如果只是想复核“为什么没补”，给 `replenish.export` 传 `include_zero=true`，会写出全部 SKU（建议量 0、滞销标记等）。

## 8. 输入路径读不了（E_REPL_PATH_INVALID）

- **症状**：`文件路径或导出文件名不可用（E_REPL_PATH_INVALID）｜下一步：传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名｜细节：找不到 "/data/store.csv"，或当前用户读不到`
- **原因**：路径拼错、文件已移动、传了目录，或当前进程没有读权限。
- **动作**：用绝对路径确认文件存在且是普通文件、当前用户可读；不要把目录当文件传。确认后重跑 `replenish.suggest`。

## 9. 导出文件名不安全（E_REPL_PATH_INVALID）

- **症状**：`...E_REPL_PATH_INVALID...｜细节：导出文件名不安全："../补货单.csv"`
- **原因**：`filename` 里带了 `../`、`/`、反斜杠、空格、中文，或超过 120 字符。
- **动作**：`filename` 只传一个由 `[A-Za-z0-9._-]` 组成的文件名，例如 `replenish-2026-11-03.csv`。目录固定为 `$DSH_HOME/dsh-store-replenish/exports/`，不要传绝对路径。

## 10. 建议量、滞销或风险标记和手工表不一样

- **症状**：没有报错，但某个 SKU 的建议量和手工算的差一箱，或某个 SKU 没有被标滞销/缺货风险。
- **原因**：① 建议量向上取整到起订量：缺口 70、MOQ 24 → 72；② 日均销量用 `sales_qty / window_days`，窗口不是 30 时结果会变；③ 滞销看的是**当前库存 / 日均**是否 > 60 天，不看在途；④ 缺货风险看 `当前库存 + 在途 < 日均 × 补货周期`，相等时不算风险；⑤ `stockout_now` 只看当前库存是否为 0。
- **动作**：用 `replenish.suggest` 的逐 SKU 字段核对：`daily_avg`、`target_qty`、`raw_qty`、`moq`、`suggested_qty`、`turnover_days`、`cover_days`、`stockout_risk`。如果仍不一致，附上脱敏后的两行输入和完整输出。

## 11. 生成了 CSV 但担心联网或改文件

- **症状**：`exports/` 下出现了 CSV，担心中间调用采购系统、ERP 或外网。
- **原因**：本包只做本地计算和本地写文件，代码里没有 HTTP、WebSocket、上传或采购下单逻辑；`dsh.demo.network` 为 `false`。
- **动作**：确认写入位置只有 `$DSH_HOME/dsh-store-replenish/exports/`，原 CSV 未被修改。是否下单、下多少、发给谁，由你或现有采购流程决定，本包不发送也不记录。

## 还不行

```sh
node samples/quickstart/run.mjs --check   # 自带样例必须通过
node --test test/*.test.mjs               # 121 项测试
node scripts/gate.mjs                     # 元数据 + 验收门
```

仍失败时请在 <https://github.com/PerryLink/dsh-store-replenish/issues> 附上：包版本、最小合成 CSV（或生成脚本）、
`replenish.suggest` / `replenish.plan` / `replenish.export` 的完整报错行、Node 与 DSH 版本。**不要附真实门店、商品或销售明细。**
