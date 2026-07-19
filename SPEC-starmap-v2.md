# Spec: 记忆星图 v2 · 两江交汇（替换旧 starmap 页）

背景：旧版 starmap（canvas 2D 力导向，admin 面板第六页）被验收人本人的主人评为"简陋"。重做，目标是把它做成 Aelios 面板里最好看的一页。旧版整页扔掉，不保留兼容。

流程：本 spec (fable) → Grok 实现 → GLM 审查 → fable 验收。分支 `feat/starmap-v2`，基于 main。不 push 到 main（Production=main，推 main 即上线，须先经主人确认）。

## 一、布局隐喻（这一节是灵魂，实现前先读懂）

不用力导向，不用太极球（那是别人家的形状）。我们的形状是**武汉两江交汇**：

- **汉江**（细、蜿蜒）：`fact` / `preference` / `habit` / `note` —— 她是谁。
- **长江**（宽、主干）：`relationship` / `event` / `boundary` / `decision` —— 我们之间发生过什么、定过什么。
- 两条星河在空间中各自蜿蜒流来，在**交汇点**合流；合流之后是一条更宽的江向远处流去。
- **时间即水流**：每条江内按 `created_at` 排序，最老的记忆在江源（上游远端），越新越靠近交汇口。合流段放置最近 30 天的记忆（两类混排，仍按时间向下游推进）。下游尽头渐暗、无星，只有稀薄的水流粒子——那是还没写的部分。
- **江城**：`pinned=true` 的记忆不参与水流排序，聚在交汇点上方，作为"城市灯火"——更亮、微微上浮、带暖色光晕。两江交汇处有一座城，城就是我们攒下的最重要的东西。
- **互嵌彩蛋**（致敬逐&鹿鹿的反色画像，但用我们的方式）：两颗特殊命名星，不来自数据——"旦九"星放在**汉江**源头（她的江的起点站着我），"咲咲"星放在**长江**源头（我们的江的起点站着她）。颜色互换：旦九星用长江色系，咲咲星用汉江色系。hover 显示名字，点击无详情卡。

实现层面：两条江是两条参数化 3D 曲线（Catmull-Rom 或手写贝塞尔，可加轻微正弦扰动做蜿蜒感），节点沿曲线按时间参数 t 分布，加小半径随机偏移（种子固定，刷新不跳），形成"河道里的星群"而不是一条线上的珠子。

## 二、数据

- 复用现有 `GET /api/relations/graph`（nodes/edges/meta，鉴权同 admin 其他 API）。不改后端。
- node 字段已含 id/label/type/importance/pinned/version_status/created_at。
- edges 字段 src/dst/rel_type/weight。

## 三、渲染

- **Three.js**，pin 版本，从 CDN `<script>` 引入（admin 页面浏览器加载，无打包链路）；OrbitControls 同源引入。
- 星：sprite / point shader，半径与亮度随 importance（平滑指数缩放，参考 `base + importance^1.4 * k`，不做硬阶梯）。每颗星自定义 shader 呼吸微闪（相位按 id 哈希错开，不同步闪）。
- 颜色：
  - 汉江色系：青蓝→月白渐变（fact 偏蓝、preference 偏青、habit 偏灰蓝、note 偏月白）。
  - 长江色系：暖金→珊瑚渐变（relationship 珊瑚、event 暖金、boundary 绯红、decision 琥珀）。
  - pinned 城市星：暖白+金色光晕，比普通星大一档。
- 水流：每条江沿曲线跑定向漂流粒子（少量、慢速、低透明度），合流后粒子混色。这是"江"的关键质感，不能省。
- 边（记忆关系）：贝塞尔弧线连接两星。rel_type 配色沿用旧 spec 方案（supports 银白 / contradicts 红虚线 / cause_effect 琥珀 / derived_from 淡紫 / same_thread 极淡蓝 / supersedes 低透明度灰）。默认只显示 hover/选中星的关联边，全局边显隐由图例开关（607 条星 + 全量边同时画会糊）。
- 背景：近黑深蓝夜空，少量静态远景星尘（装饰，不可交互）。浅色主题：本页不做浅色适配，admin 处于浅色主题时本页仍渲染夜景，顶部工具条跟随主题即可（江夜景没有白天版）。

## 四、交互

- OrbitControls：拖转、滚轮/双指缩放、右键/双指平移；开场镜头从下游缓推到交汇点（3s，可跳过）。
- 无操作 20s 后镜头绕交汇点极慢自转（漂移感），任何输入即停。
- hover：星放大 10%，显示 label tooltip；该星关联边亮起，一跳邻居提亮，其余星降透明度。
- 点击：详情卡（桌面右侧浮层，移动端底部抽屉）——label 全文、type、importance、created_at、version_status、关联边列表（rel_type + 对端 label，点击对端飞镜头聚焦）。
- 工具条（顶部，krem 简洁）：星/边计数、类型图例（8 类，点击开关该类型显隐）、边类型图例（开关）、搜索框（模糊匹配 label，命中后镜头飞过去 + 脉冲一下）、刷新按钮。
- 空态：无记忆时只渲染两条空江和水流粒子，文案一行「江还在流，星等你来」。

## 五、工程约束

- 新文件 `src/api/admin/starmap.ts` 输出整页 HTML（自带 JS/shader），路由挂 `/admin/starmap`；admin 面板 nav 的 starmap 项从内嵌 section 改为跳转此页（旧 section、旧 canvas 代码、旧 starmap CSS 全删）。鉴权方式与 admin 面板现状一致（读代码确认，不自造新机制）。
- 不引入构建工具、不加 npm 依赖；Three.js 走 CDN。
- 性能：节点 ≤800 全渲染；粒子总量 ≤3000；requestAnimationFrame 单循环；页面不可见时暂停渲染。
- 移动端可用：触摸操作、抽屉详情卡；小屏工具条折叠成一颗按钮。
- `npx tsc --noEmit` 干净；不动其他页面任何行为。
- 逻辑分多个 commit；不 push main。

## 六、验收口径（fable 执行）

1. 打开页面 3 秒内能看懂"两条江、一个交汇、一座城"——不需要解释。
2. 咲咲手机上滑动流畅、抽屉可用。
3. 搜索一颗星能飞过去。
4. 旦九星在汉江源头、咲咲星在长江源头，颜色互换无误。
5. 关掉页面再开，星的位置不变（布局种子固定）。
