# 梦境观测台 + 星空主题重构 — 交付说明

分支 `feat/dream-console`，共 3 个 commit（未 push）：

| commit | 内容 |
| --- | --- |
| `feat(api): add dream harvest endpoint` | 新端点 + 3 个只读查询 helper + 路由注册 |
| `refactor(admin): starry-night theme` | 全站星空主题（色板变量 / 星 field / 玻璃拟态 / coral 兜底） |
| `feat(admin): dream console page` | 梦境页（时间线 / 统计 / 触发 / dry-run 预览 / 当夜收成） |

改动文件：`src/api/dream.ts`、`src/db/v2/memories.ts`、`src/db/v2/candidates.ts`、`src/index.ts`、`src/api/admin/ui.ts`。无 schema 变更、无新依赖、无构建步骤，`ADMIN_HTML` 仍为单文件 `String.raw`。

## 一、新端点契约

`GET /admin/dream/harvest?date=YYYY-MM-DD&namespace=...`（`src/api/dream.ts` 的 `handleDreamHarvest`，路由在 `src/index.ts`）

- 鉴权：与 `handleDreamStatus` 相同（`authenticate` + `memory:write` scope）。
- 参数：`date` 必填，`YYYY-MM-DD`（且月 1–12、日 1–31）；`namespace` 可选，缺省取 key 的 namespace。
- 时间窗：复用 `getDateRangeForLabel(date, DREAM_TIME_ZONE)`，即该 date_label 在梦境时区里的自然日。
- 响应 `{ data: { namespace, date, time_zone, created, dormant, candidates } }`：
  - `created`：当夜新写入的记忆（`created_at` 落窗，不限 status）：`id / type / content / importance / status / created_at`
  - `dormant`：当夜转入沉眠的记忆（`status IN (superseded, archived)` 且 `updated_at` 落窗）：附加 `superseded_by`、`updated_at`
  - `candidates`：当夜判决的候选（`status IN (approved, discarded)` 且 `updated_at` 落窗）：`memory_candidates` 整行（含 `decision_note`）
- 错误：无 token 401；缺 scope 403；date 缺省/非法 400（`openAiError` 格式与全站一致）；异常 500。
- 实现：新增 `listMemoriesCreatedInRange` / `listMemoriesGoneDormantInRange`（`src/db/v2/memories.ts`）、`listJudgedCandidatesInRange`（`src/db/v2/candidates.ts`），全部带 namespace 过滤 + LIMIT 兜底（默认 200，上限 500）。

已验证：401 / 403 / 400（`2026-13-99`）/ 200 正常返回三组数据；`namespace=other` 只返回该空间数据（隔离双向成立）。

## 二、色板变量表（`ui.ts` `<style>` 顶部集中定义）

| 变量 | dark 深空 | light 晨昏 | 用途 |
| --- | --- | --- | --- |
| `--bg-deep` | `#070a16` | `#eceef8` | 页面底色 / 输入框底 |
| `--bg-deep-95 / -70` | 深蓝黑 94%/70% | 晨雾 94%/72% | 底栏、加载遮罩 |
| `--panel-bg` | `rgba(21,27,54,.55)` | `rgba(255,255,255,.6)` | 玻璃卡 |
| `--panel-bg-strong` | `rgba(23,29,58,.88)` | `rgba(252,252,255,.9)` | 抽屉 / 高遮罩卡 |
| `--panel-border` | `rgba(148,163,255,.16)` | `rgba(109,92,210,.18)` | 1px 微光边 |
| `--panel-glow` | 内高光+深影 | 内高光+淡紫影 | 卡片阴影 |
| `--text-1..4` | `#eef0ff → #6d7299` | `#232437 → #888cb2` | 文字四档 |
| `--coral` | `#F4A07C` | 同 | 动作色（保留） |
| `--violet / --cyan` | `#8b7cf6 / #67e8f9` | 同 | 极光辅助色 |
| `--aurora` | 135° 紫→青渐变 | 同 | 徽标 / 图表 / 统计牌 |
| `--ok / --err / --warn` | `#6ee7b7 / #f87171 / #fbbf24` | 同 | 状态徽标 |
| `--nebula-1/2` | 紫 13% / 青 9% | 珊瑚 22% / 紫 16% | 星云渐变 |
| `--star-1..3` + `--stars-opacity` | 白/蓝/珊瑚，0.9 | 紫/珊瑚/青，0.5 | 星点 |

既有 zinc/`#0a0a0b` 工具类整体映射到上述变量（沿用仓库原有的覆盖式换肤手法），页面标记未为换肤改动一行。星 field 为纯 CSS：两层 `radial-gradient` 星点只动 opacity（9s/13s 交替）+ 两片星云，`prefers-reduced-motion: reduce` 下全部静止。星图 canvas 底色同步为 `#070a16 / #eceef8`。

## 三、已知取舍与说明

1. **主题默认值**：spec §0 说"暗色默认"，但仓库代码实际默认 **light**（`localStorage 'aelios.admin.colorMode' || 'light'`）。按 spec"冲突以代码为准"，未改动默认逻辑。
2. **coral 存量 bug（顺手修了）**：head 里 `tailwind = { config: {...} }` 会被 Tailwind Play CDN 自身的 `window.tailwind` 覆盖，自定义 `coral` 色板实际从未生成（`bg-coral` 等类在所有浏览器里都是透明的）。本次在 `<style>` 里用 `--coral` 变量自行定义了 `bg-coral / text-coral / hover:border-coral / focus:border-coral / active:bg-coral/80`，两套主题同源、与 CDN 版本无关。未动 head 脚本（零加载顺序风险）。
3. **成功率口径**：`ok / (ok + error)`，skipped（已梦过/无消息/预演）不计入；无 ok/error 时显示 `—`。
4. **harvest 归窗口径**：`created` 按 `created_at`、`dormant` 按 `updated_at` 落窗。同一夜出生又被替代的记忆会同时出现在两栏（新生栏会带非 active 的 status 标签）——语义上它确实"来过又暗下去了"。
5. **移动端 tab 7→8**：390px 宽度下每格约 48px，仍满足 44px 触控目标；实测截图可读。
6. **dry-run 预览**：结构化面板（提案 / 抽取卡 / 路由分组）的渲染逻辑已用 mock 数据在 JS 层验证；本地 `wrangler dev` 的 AI binding 不支持真跑模型，端到端 dry_run 需在部署环境点一次确认。
7. **本地验证方式**：`wrangler.toml` 的 D1 绑定由 `npm run setup:cloudflare` 生成；本地验收时临时追加了 `[[d1_databases]]` + `wrangler d1 migrations apply --local` + `--var CHATBOX_API_KEY=...`，验证完已还原，未进 commit。
8. 星图空态、时间线空态、收成空态均沿用现有"还没有星星"语气的兜底文案；全站文案无"死亡/消亡/生死簿"字眼。

## 四、验证记录

- `npx tsc --noEmit` 通过（最终状态复跑确认）。
- `String.raw` 约束：全文反引号仅模板首尾两个，无 `${`。
- `wrangler dev` 本地跑通：面板 200；harvest 401/403/400/200 与 namespace 隔离均实测通过。
- headless Chromium 逐页截图点验：今日 / 日记 / 梦境 / 审核 / 记忆 / 更多 / 星图 / 设置（移动）在 dark 与 light 下均可读；梦境页桌面 + 移动两态完整渲染真实接口数据。
