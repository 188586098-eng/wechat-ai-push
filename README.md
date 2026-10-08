# WeChat AI 资讯推送

聚合 AI 头部自媒体（量子位、新智元、36氪、机器之心等 11 源）的最新文章，通过 pushplus 推送到你的微信。

## 背景说明

微信公众号没有公开的文章列表 API。数据中心网络环境下，搜狗微信搜索、聚合平台、RSSHub 微信路由等公众号数据源全部受限或需登录。本项目的替代方案：
1. 抓取这些自媒体在**官网**同步发布的公开内容（与公众号文章基本一致）
2. 通过 **wewe-rss**（自建，SQLite 版）以微信读书账号订阅公众号，生成 RSS 作为数据源

| 公众号 | 数据源 | 类型 |
|--------|--------|------|
| 量子位 | https://www.qbitai.com/ | 官网首页 |
| 智东西 | https://www.zhidx.com/ | 官网首页 |
| 新智元 | https://aiera.com.cn/ | 官网首页（WordPress） |
| 36氪 | https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot | 官网热榜 API |
| InfoQ / AI 前线 | https://www.infoq.cn/ | 官网热榜（Nuxt SSR 数据） |
| 刘润 | https://m.163.com/news/sub/T1466412414497.html | 网易号 |
| 数字生命卡兹克 | https://www.panewslab.com/zh-hant/columns/019e8dd4-8e70-708c-aaa5-1e9a821cf304 | PANews 专栏 |
| GitHub 热门（替代逛逛GitHub） | https://github.com/trending | GitHub Trending |
| 极客公园 | https://wechat2rss.xlab.app/feed/1a5aec98e71c707c8ca092bc2c255b9d4bac477d.xml | 公众号 RSS（wechat2rss） |
| 机器之心 | http://localhost:4000/feeds/MP_WXS_3073282833.rss | wewe-rss 公众号 RSS |
| 虎嗅 | http://localhost:4000/feeds/MP_WXS_1432156401.rss | wewe-rss 公众号 RSS |

## 当前状态：全部定时任务已暂停（2026-10-07）

账号下所有云端定时任务已于 2026-10-07 以 GitHub 原生开关手动禁用，**不再采集、不再推送**。这些任务现改为**本机手动执行**，具体命令见下一节《本地运行手册》。

| 仓库 | 工作流 | 原频率（北京时间） |
|---|---|---|
| ai-news-daily | ai-news-daily | 05:07 / 08:23 |
| wechat-ai-push | AI 资讯日报定时推送 | 07:00 |
| wechat-ai-push | 历史低位好价定时推送 | 09:00 / 21:00 |
| wechat-ai-push | 羊毛线报实时推送 | 每 30 分钟 |
| shuili-jianli-push | 水利监理周报 | 手动为主 |

禁用只改 GitHub 侧的开关，**未改动任何 workflow 代码**，因此恢复不需要回滚代码。逐条执行以下命令即可全部还原：

```bash
gh workflow enable ai-news.yml     -R 188586098-eng/ai-news-daily
gh workflow enable ai-news.yml     -R 188586098-eng/wechat-ai-push
gh workflow enable price-deals.yml -R 188586098-eng/wechat-ai-push
gh workflow enable wool-push.yml   -R 188586098-eng/wechat-ai-push
gh workflow enable weekly.yml      -R 188586098-eng/shuili-jianli-push
```

也可在网页操作：仓库 → **Actions** → 左侧选工作流 → **Enable workflow**。

## 本地运行手册（当前执行方式：本机手动）

云端已停用，所有任务改为**本机手动执行**。本节面向"拿到仓库就能跑"的其他 Agent/同事：命令可直接复制，并标注了是否需要联网、**是否会真的推送微信**、前置条件与状态文件。

### 0. 一次性准备

- **Node ≥ 18**（代码使用全局 `fetch` 与 `AbortSignal.timeout`）
- 安装依赖（**在仓库根目录执行**）：
  ```bash
  npm install                       # 必需（qrcode 等）
  npx playwright install chromium   # 可选：仅"需要浏览器"的任务（见总览表）
  ```
- 配置：`cp config.example.json config.json`，填入 `pushplusToken`
  - **AI 资讯日报**（含 `src/scheduler.js`）把 `config.json` 当**硬性依赖**，缺失会直接报错
  - 其余任务在缺 `config.json` 时走内置默认值（好价任务此时需用环境变量 `DEAL_KEYWORDS` 指定关键词，否则静默跳过）
- 推送 token 优先级：环境变量 `PUSHPLUS_TOKEN` > `config.json` 的 `pushplusToken`
- ⚠️ **真实运行会推到接收人微信**。只想验证链路时，请用下表的「静默自检」命令。

### 1. 任务总览

| 任务 | 运行命令 | 联网 | 会推送 | 需 `config.json` | 需 playwright | 状态 / 产物 |
|---|---|:--:|:--:|:--:|:--:|---|
| AI 资讯日报（单次） | `npm start` | 是 | 有新增时 | **必须** | 否 | `data/sent.json` |
| AI 日报常驻调度 | `node src/scheduler.js` | 是 | 到点自动 | **必须** | 否 | `data/lastrun.json` |
| 羊毛线报 | `npm run wool` | 是 | 是 | 可选 | 否 | `data/wool-seen.json`、`data/wool-runs.jsonl` |
| 好价·历史低位 | `npm run price:deals` | 是 | 是 | 可选 | 否 | `data/deals-seen.json` |
| 价格监控（指定商品） | `npm run price` | 是 | 是 | 必须（`price.products`） | **是** | `data/price-cookies.json` |
| 公众号文章归档 | `npm run wechat-archive -- <参数>` | 是 | 否 | 否 | 按需 | `<out>/.archive-state.json` |
| 剪贴板归档（常驻） | `clipboard-watch.cmd` | 是 | 否 | 否 | 按需 | `data/clipboard-archive.log` |
| 水利招聘采集 | `npm run jobs` | 是 | 新增时 | 可选 | 按需 | `data/jobs/` |
| 招聘常驻调度 | `npm run jobs:schedule` | 是 | 新增时 | 可选 | 按需 | `data/jobs/` |
| 晚间续期 | `renew-task.cmd` | 是 | 否 | **必须** | 否 | `data/renew.log` |

> "需 playwright"指该路径会启动 Chromium；标"按需"的是只有个别分支用浏览器（未安装时该分支会报错并跳过，其余照常）。

### 2. 静默自检（不推送、不打扰接收人）

| 任务 | 安全自检命令 |
|---|---|
| 羊毛线报 | `npm run wool -- --dry-run`（离线自检用 `--mock`） |
| 好价·历史低位 | `npm run price:deals -- --dry-run` |
| 招聘采集 | `npm run jobs:dry` 或 `npm run jobs:mock` |
| 公众号归档 | `npm run wechat-archive -- --rss 极客公园 --dry-run` |
| 价格监控 | `npm run price:mock` ⚠️ **会真推一条测试消息** |

### 3. 逐任务说明

#### 3.1 好价·历史低位（`--deals`）

按关键词在慢慢买爆料流里筛"历史低位"商品推送（卡片自动折算单件价、剔除"已结束"）。

```bash
npm run price:deals                              # 真实推送
npm run price:deals -- --dry-run                 # 只抓取并打印报告，不发送
DEAL_KEYWORDS="达利园 法式软面包,统一 麻辣青花椒" npm run price:deals   # 临时改监控词
```
- 关键词来源：环境变量 `DEAL_KEYWORDS`（逗号分隔）> `config.json` 的 `price.dealKeywords`；**两者都空则跳过、不推送**
- 单次条数上限 `price.dealMaxItems`（默认回退 `price.dealTopN`）
- 跨次去重：`data/deals-seen.json`（14 天 TTL）
- **本任务纯 `fetch`，不依赖 playwright**（2026-10-07 修复过：此前顶层 `require('playwright')` 导致无 `node_modules` 环境启动即崩、云端 81 次全失败）

#### 3.2 羊毛线报

```bash
npm run wool                # 真实推送
npm run wool -- --dry-run   # 打印报告，不发送
npm run wool -- --mock      # 离线模拟数据，走完整链路
npm run wool -- --stats     # 查看最近 30 次"发布→推送"时差分布
```
- 关键词：`WOOL_KEYWORDS` > `config.wool.keywords` > 内置默认清单；排除词 `WOOL_EXCLUDE_KEYWORDS` / `config.wool.excludeKeywords`
- 强弱词分层：强词命中 1 个即推；弱词需 ≥ `config.wool.minWeakHits`（默认 2）
- 状态：`data/wool-seen.json`（去重）、`data/wool-runs.jsonl`（时差记录）

#### 3.3 价格监控（指定商品历史价）

```bash
npm run price:auth          # 首次：打开浏览器扫码授权（京东商品需用慢慢买 App 扫码）
npm run price               # 检查监控清单价格并推送
npm run price:mock          # 用内置模拟数据跑通链路（会推测试消息）
```
- 监控清单：`config.json` 的 `price.products`（`name` / `url` / `targetPrice`）
- 授权会话：`data/price-cookies.json`；**此任务需要 playwright + chromium**

#### 3.4 水利招聘采集

```bash
npm run jobs                                       # 抓取→筛选→落盘→推送新增
npm run jobs:dry                                    # 只采集与打印，不写文件、不推送
npm run jobs:mock                                   # 样例数据自检，不联网
npm run jobs:stats                                  # 查看历史运行
npm run jobs -- --site=zhaopin                       # 只跑指定渠道
npm run jobs -- --no-push                            # 落盘但不推送
npm run jobs:login -- <渠道>                         # 需登录渠道：人工登录一次存会话
npm run jobs:schedule                                # 常驻定时
node src/jobs/scheduler.js --once                    # 定时器跑一轮即退出
```
- 产物：`data/jobs/` 下 `jobs.csv` / `jobs.md` / `jobs.json` / `jobs.jsonl`，日志 `data/jobs/logs/`
- 浏览器渠道（前程无忧等）需要 playwright；纯 HTTP 渠道不需要

#### 3.5 公众号文章归档 / 剪贴板

```bash
npm run wechat-archive -- --rss 极客公园 --limit 3   # 按号名取最新 N 篇
npm run wechat-archive -- --list-feeds 极客          # 查内置号名单
npm run wechat-archive -- "https://mp.weixin.qq.com/s/xxxxx"   # 微信「复制链接」短链
clipboard-watch.cmd                                  # 常驻：复制链接即自动归档（需 PowerShell）
```
常用选项：`--out <目录>`、`--dry-run`、`--force`、`--no-images`，详见下文《公众号文章下载到本地》。

#### 3.6 AI 资讯日报

```bash
npm start                    # 单次：抓取 11 源 → 只推新增 → 推送微信
node src/scheduler.js        # 常驻：每 1 小时检查，距上次 ≥24 小时则自动跑
```
- **依赖 `config.json`**（顶层硬读）与本地 **wewe-rss**（`http://localhost:4000`，提供公众号 RSS 源）
- 状态：`data/sent.json`（已推送去重）

### 4. 排错速查

| 现象 | 处理 |
|---|---|
| `Cannot find module 'playwright'` | 该任务需要浏览器：`npx playwright install chromium`；若不需浏览器（如 `--deals`），说明依赖被顶层加载了，应改用按需 `require` |
| `Cannot find module 'qrcode'` | 未装依赖：在仓库根目录 `npm install` |
| `Cannot find module './config.json'` / `ENOENT config.json` | 先 `cp config.example.json config.json` |
| 好价/羊毛"0 条命中、不推送" | 检查关键词是否配置（`DEAL_KEYWORDS` / `WOOL_KEYWORDS`），以及 `data/*-seen.json` 是否已把条目去重掉 |
| 抓取全部失败 | 目标站点风控或改版；单源失败只记日志，不影响其余源 |
| `git push` 报 `schannel ... SSL/TLS connection failed` | 本机 git 配的代理（`http.proxy`）不通；临时绕过：`git -c http.proxy= push` |

## 使用方法

### 1. 获取 pushplus token

1. 访问 https://www.pushplus.plus/ ，用微信扫码登录
2. 在「一对一推送」页面复制你的 token

### 2. 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入 `pushplusToken`。可在 `sources` 里按需启用/停用数据源。

### 3. 运行

```bash
npm start
```

- 首次运行会把每源最新文章推送到微信（默认每源前 10 篇）
- 之后运行只推送**新增**的文章，已推送过的不会重复
- 已推送记录保存在 `data/sent.json`（自动生成，不入库）

### 4. 定时自动推送

内置常驻调度器 `src/scheduler.js`：每小时检查一次，距离上次推送超过 `pushIntervalHours`（默认 24 小时）即自动运行并推送，无新文章时跳过。

```bash
node src/scheduler.js
```

调度间隔可在 `config.json` 中调整：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `pushIntervalHours` | 24 | 两次推送的最小间隔 |
| `checkIntervalHours` | 1 | 调度器检查频率 |
| `loginCheckIntervalHours` | 6 | 微信登录失效检测频率（小时） |

### 5. 手机端扫码续期（自动同步 + 自动重推）

微信读书 token 过期时（云端日报只剩官网源、且收到「登录已失效」提醒），只需**手机操作**：

1. 保持本地 devbox 在线（wewe-rss + scheduler 运行中）
2. 手机会收到带二维码的推送（scheduler 检测到失效后自动发送）
3. 用**微信读书 App** 扫二维码确认
4. 续期成功后自动完成：写回 wewe-rss 数据库 → 同步 `WEWE_TOKEN` 到 GitHub Secret → 触发云端 workflow 立即重推完整日报

实现依赖 `config.json` 中配置 GitHub 凭据（二选一）：

```jsonc
{
  "githubToken": "ghp_...",        // GitHub PAT（需 repo 权限，与 sync-secret.sh 相同凭据）
  "githubRepo": "188586098-eng/wechat-ai-push"   // 可选，默认值即此
}
```

> 说明：token 不会写入任何文件，仅通过 `gh secret set` 传入 GitHub。若未配置 `githubToken`，扫码续期仍会在本地生效，但需手动运行 `sync-secret.sh` 同步云端。

## 注意事项

- 抓取频率保持低频（单次请求每源一页），避免触发站点风控
- 若某数据源改版导致解析失效，运行日志会显示「失败」，按需调整 `src/sources.js`
- 推送选文按**源轮询**取篇（每源最多 `perSourceLimit` 篇），保证各源都有机会入选，总数不超过 `pushLimitPerRun`

## 公众号文章下载到本地

把公众号文章存成本地 Markdown + 本地图片，按公众号分目录：`<out>/<公众号>/<日期>-<标题>.md`。

```bash
# 方式一：RSS 全文（推荐，完全不用手动另存）
npm run wechat-archive -- --rss 极客公园                    # 按公众号名，默认取最新 5 篇
npm run wechat-archive -- --rss 量子位 --limit 3
npm run wechat-archive -- --rss 极客公园 --dry-run           # 只看会归档哪些，不写盘
npm run wechat-archive -- --list-feeds 极客                  # 查内置免费号名单（共 395 个）
npm run wechat-archive -- --rss "https://wechat2rss.xlab.app/feed/xxx.xml"   # 任意 feed 地址

# 方式二：本地保存的网页（RSS 覆盖不到的号用这个）
npm run wechat-archive -- --html "C:\path\to\文章.html"
npm run wechat-archive -- --html "C:\path\to\网页目录"      # 批量转换目录下所有 .html

# 方式三：直接给链接（微信里「⋯ → 复制链接」得到的短链）
npm run wechat-archive -- "https://mp.weixin.qq.com/s/xxxxx"
npm run wechat-archive -- --in links.txt                    # 每行一条，# 为注释

# 常用选项
--out <目录>    输出目录，默认 data/wechat-archive
--delay <毫秒>  两篇之间的间隔，默认 1500
--limit <n>     --rss 每个 feed 取最新几篇，默认 5
--force         忽略去重记录，重新归档
--no-images     不下载图片，保留远程地址
```

- **想少花手工，用 `--rss`**：它不需要逐篇打开或另存，一次跑完一个号的最新 N 篇（含全文和图片），配合定时任务可完全无人值守。
- 内置的是 [wechat2rss](https://wechat2rss.xlab.app/list/all) 免费号名单（395 个，`--list-feeds` 可搜）。名单外的号有两条路，产出的都是 RSS，用 `--rss <feed地址>` 直接可用：wechat2rss **私有部署**（付费，可订阅任意号），或自建 [wewe-rss](https://github.com/cooderl/wewe-rss)（免费，用微信读书账号扫码登录后订阅任意号）。
- 名单外的号若只偶尔要看几篇，用不着折腾 RSS：在微信里「⋯ → 复制链接」把短链攒进 txt，`--in links.txt` 一次归档全文和图片。代价是逐篇复制。
- `--rss` 和链接方式会把 `链接 -> 已归档文件` 记到 `<out>/.archive-state.json`，重复/定时跑只归档新文章；要重跑加 `--force`（不覆盖旧文件，会生成 `-2` 副本）。
- RSS 正文在 `content:encoded`（`description` 只是几十字的摘要），其中图片和链接都带 wechat2rss 的代理前缀，工具会按 `u=` 参数还原成原始 `mmbiz.qpic.cn` / `mp.weixin.qq.com` 地址再处理。
- 刷新内置名单：`node src/wechat-archive/refresh-feeds.js`
- **微信按 URL 形式风控 `mp.weixin.qq.com`**：短链 `/s/xxxxx` 本机能直接取到全文和图片；长链 `?__biz=...` 只会拿到 `verify.js` 验证页（无 `js_content`），换 UA / 加 Referer / 无头浏览器均无效。微信里「⋯ → 复制链接」给的正是短链，所以「方式三」通常直接可用，是名单外公众号取全文最省事的办法。
- 图片走 `mmbiz.qpic.cn`，**不走文章页风控**，三种方式都能正常下载；浏览器「另存为完整网页」产生的同名 `_files` 目录里的图片也会被一并收录到 `images/`。
- 抓取逻辑复用用户级 skill `wechat-article-extractor`（含删除/迁移/已过期等失效页判断），可用环境变量 `WECHAT_SKILL_DIR` 指定其目录。
- skill 对「另存网页」常判错（缺 `var ct` 报 1001、中文日期 `2026年5月10日 10:33` 算出 `Invalid Date`）时会自动退到本地结构解析，日志标注「兜底解析」。
- 少量文章的正文由 JS 注入，原始 HTML 里没有 `#js_content`，此时自动用 Playwright 渲染后再解析（账号名等只在页内 JS 变量里的字段也会一并带出）。需先 `npm i -D playwright && npx playwright install chromium`；未安装会跳过并报错提示。
- 只下载正文真正会渲染的图片：公众号头像卡片等无关 `<img>` 直接剔除，不产生无引用文件。
- 下载按**文件头**校验格式（而非 URL 后缀），微信对图片返回 HTML 错误页时会被拒绝并保留远程地址，避免把 HTML 存成 `.jpg`。
- `--html` 保存类型请用「网页，全部 (*.htm;*.html)」；误存成 `.mht` 会明确报错提示。

## 羊毛线报实时推送

聚合白菜哦（商品好价）/ 专业线报 / 赚客吧 / 新赚吧 / 线报迷（论坛活动线报）共五类优惠信息，按订阅关键词过滤后推送微信。云端每 30 分钟运行一次，每条仅推送一次。

```bash
npm run wool        # 手动运行（抓取→过滤→去重→推送）
npm run wool:mock   # 模拟数据自检，不联网
```

- 关键词：环境变量 `WOOL_KEYWORDS`（逗号分隔）> `config.json` 的 `wool.keywords` > 内置默认清单；排除词同理（`WOOL_EXCLUDE_KEYWORDS` / `wool.excludeKeywords`）
- **强弱词分层**：内置词分强词（快递/银行/话费/免单等主题，命中 1 个即推）与弱词（红包/会员/领券等泛词，仅命中需 ≥2 个，`wool.minWeakHits` 可调），抑制"标题含个红包就推"的低信息量推送
- **热门槽**：未命中关键词但社区参与度高（回复/浏览多）的新帖也会优先推荐（每轮默认 ≤4 条，`wool.hotSlots` / `wool.hotMinScore` 可调），示例徽标「🔥热门·回N/浏N」
- 云端任务：`.github/workflows/wool-push.yml` 每 30 分钟运行，去重状态存 `data/wool-seen.json`，通过 actions/cache 跨次运行持久化
- 时差与运行分析：每次真实推送把发布→推送时差写入 `data/wool-runs.jsonl`，`node src/wool/index.js --stats` 查看最近 30 次分布
- 单个来源抓取失败只记日志，不影响其余来源推送

## 水利行业招聘信息采集

按岗位关键词定期抓取水利行业招聘信息（监理方向：水利工程监理/总监理工程师/监理资料员/监理测量…；施工方向：项目副经理/项目总工程师/施工资料员…），去重后以 JSONL + JSON + CSV + Markdown 落盘。

```bash
npm run jobs            # 采集一轮：抓取→关键词筛选→去重→落盘(data/jobs/)→微信推送新增
npm run jobs:dry        # 只采集与打印，不写文件、不推送
npm run jobs:mock       # 样例数据自检，不联网
npm run jobs:stats      # 查看历史运行（各渠道抓取/命中/新增、耗时、失败标记）
npm run jobs:schedule   # 常驻定时执行（间隔小时或每日固定时刻）
npm run jobs:login -- <渠道>  # 需登录的渠道：弹出浏览器人工登录一次，保存会话供复用
```

- **实测可用渠道**：智联招聘（HTTP，含详情页权威发布时间）、前程无忧（浏览器渲染，含 jobTime 发布时间）、**工程监理人才网 job2299（HTTP，监理垂直站，`robots.txt` 允许抓取，列表页自带公司/地点/薪资/发布时间）**、**监理招聘网 jianlihr（HTTP，监理垂直站，关键词页 `/jobs/keys-{kw}.html`，列表自带薪资/发布日期/公司/地点）**、**水利英才网 waterhr（HTTP，水利垂直站，关键词搜索 `SearchResult.php?jtzw={kw}`，列表自带经验/学历/地点/薪资/更新时间）**、**中国水利人才网 rencai（HTTP，水利部官方平台的公开招聘公告）**、中国水利工程协会与江苏省水利厅公告（HTTP），以及 **6 个省级水利厅公告页：山东·招考录用、广东·人事信息（两栏均为事业单位公开招聘，实测命中率最高）、四川·公示公告、安徽/陕西/福建·通知公告（HTTP，省厅招聘公告，低频高价值兜底）**。**BOSS直聘与猎聘已实测定案关闭**：BOSS 会跳「安全验证」滑块页、登录页直接空白；猎聘则是双重拦截（首页/搜索页渲染约 2.5 秒后自毁 + 出口 IP 被标记进 `intercept/ip/captcha` 验证码通道，纯 HTTP 请求即被 302，**导入 Cookie 也无效**）。两者均属站点反自动化/IP 风控，本程序不绕过。**建筑英才网 buildhr 也已排除**：真实职位列表只在 `robots.txt` 明确禁止的 `/so/` 路径下，其余为 JS 空壳。**国聘 iguopin.com 亦不接入**：其职位列表接口强制要求 `Sign`/`T`/`Nonce` 请求签名头（裸调一律返回 `data:null`），直采需逆向签名算法，属本项目禁止的 token 逆向。另有 4 个省厅公告页未能接入：湖北（412 WAF）、云南（域名不可达）、浙江与湖南（栏目 JS 渲染）。会话导入通道（`jobs:login --cookie-file`）保留给未来新增的需登录渠道，详见 `docs/jobs-scraper.md` 第二节。
- **关键词分层**：强词（水利监理/总监理工程师…）单独命中即收；弱词（监理/资料员/项目经理…）须与水利行业词同现，且排除平台多行业分类标签（如 `电力/水利/热力/燃气`），避免电力、市政岗位误收。回归自测 `node src/jobs/keywords.test.js`。
- **有效期过滤**：默认只收发布时间在 **180 天（半年）内**的岗位（`jobs.maxAgeDays`，收紧到 3 个月填 `90`），过期岗位在运行摘要里记为 `过期(早于180天)`；自测 `node src/jobs/fresh.test.js`。
- **登录态**：保存于 `data/jobs/auth/<渠道>.json`（含 Cookie，等同个人凭证，已被 gitignore；勿外传）；失效时日志会提示重新登录。程序不绕验证码、不伪造账号。
- **稳定性**：请求重试+指数退避+随机 2–5s 间隔、按天日志（`data/jobs/logs/`，本地时间命名）、单渠道失败不影响整体、两级去重（岗位主键 + 单位/岗位/地点指纹）、页面结构变化容错。
- 输出：`jobs.csv`（Excel 直开）、`jobs.md`（分组表格便于阅读）、`jobs.json`（最新快照）、`jobs.jsonl`（全量增量）。
- **微信推送**：每轮把**新增**岗位汇总成一条消息推送到微信（复用 `pushplusToken`）。只推新增、不重推历史；单条最多列出 `jobs.push.limit`（默认 10，本机现为 12）条，超出部分只报总数，避免微信截断。`jobs.push.enabled: false` 或 `--no-push` 可关闭；`JOBS_PUSH_LIMIT` 可临时改条数。自测 `node src/jobs/notify.test.js`。
- 新增渠道无需改代码，配置 `jobs.sites` 的 URL + 抽取规则即可，详见 `docs/jobs-scraper.md`。

## 依赖的 wewe-rss 服务

机器之心、虎嗅等公众号源依赖本地运行的 wewe-rss（http://localhost:4000）：
- 微信读书账号扫码登录后订阅公众号，`/feeds/{mp_id}.rss` 输出 RSS 2.0
- wewe-rss 为自建部署（/tmp/opencode/wewe-rss，SQLite 模式，AUTH_CODE=wewe-admin-2026）
- 若该服务未运行，对应源会抓取失败并在日志提示，其余官网源不受影响
