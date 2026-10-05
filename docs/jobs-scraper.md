# 水利行业招聘信息采集（src/jobs）

按岗位关键词定期抓取水利行业招聘信息（监理方向 / 施工方向），去重后以 JSONL + JSON + CSV + Markdown 四种格式落盘，并把**本轮新增岗位推送到微信**；支持定时运行、失败重试与完整日志。

```bash
npm run jobs              # 采集一轮：抓取→关键词筛选→有效期过滤→去重→落盘→微信推送新增
npm run jobs:dry          # 只采集与打印，不写文件、不登记去重状态、不推送
npm run jobs:mock         # 内置样例数据自检，不发网络请求
npm run jobs:stats        # 查看最近运行历史（各渠道抓取/命中/新增、耗时、失败标记）
npm run jobs:schedule     # 常驻进程，按 config.json 的 jobs.schedule 定时执行
npm run jobs:login -- boss   # 需要登录态的渠道：人工登录一次并保存会话
```

单项开关：`node src/jobs/index.js --site=zhaopin`（只跑指定渠道）；`--no-push` 真实采集落盘但不推微信。

## 一、采集渠道支持矩阵

下表是 **2026-09~10 在本机实测** 的结果，而非推测。渠道是否可用会随目标站改版、风控策略和你的网络出口变化，因此程序把每个渠道做成可开关、可配置的适配器。

| 渠道 | 类型 | 实测状态 | 说明 |
| --- | --- | --- | --- |
| 智联招聘 `zhaopin` | HTTP | ✅ 可用 | 游客可见服务端渲染列表，20 条/页可翻页；**列表页无发布时间**，由详情页 `__INITIAL_STATE__` 的 `positionPublishTime` 补全 |
| 前程无忧 `51job` | 浏览器 | ✅ 可用 | 列表卡片带 `sensorsdata` 结构化属性（含 `jobTime` 发布时间、薪资、地点、jobId）；结果受出口 IP 地域影响（本机多为上海）。**职位详情页需人工滑块验证**，故详情链接仅供你点开查看 |
| 工程监理人才网 `job2299` | HTTP | ✅ 可用 | **监理垂直站**，与监理方向高度对口。`robots.txt` 为 `Disallow:`（空）→ 允许抓取；纯服务端 HTML，无需浏览器；列表 `/jobs?page=N` 翻页有效（20 条/页），**列表页自带公司/地点/类别/经验/薪资/发布时间**（无需详情页补全） |
| 监理招聘网 `jianlihr` | HTTP | ✅ 可用 | **监理垂直站**。robots 仅禁简历/管理路径，职位页允许；纯服务端 HTML；关键词页 `/jobs/keys-{kw}.html`（翻页 `-p-{N}.html`），**列表自带 职位名/薪资/发布日期/公司/地点**。实测：抓 104 条 → 命中 54 条水利监理岗 |
| 水利英才网 `waterhr` | HTTP | ✅ 可用 | **水利垂直站**（job1001 平台）。robots 仅禁 4 个管理路径（`/my/` 等），公开职位页允许；关键词搜索 `SearchResult.php?jtzw={kw}&page={N}`，**列表自带 经验/学历/地点/薪资/更新时间**。实测：抓 94 条 → 命中 74 条 |
| 中国水利人才网 `rencai` | HTTP(公告) | ✅ 可解析 | **水利部官方平台**的招聘公告（直属单位/国企公开招聘）。公告为「表格行+发布日期」，用通用公告适配器即可解析。发布频率低但权威，属低频兜底 |
| BOSS直聘 `boss` | 浏览器 | ❌ 不可自动化 | 实测（2026-10）首页/搜索页均被跳转到 `…/passport/zp/verify.html`「安全验证」滑块页，登录页直接 `about:blank`。**本程序不绕过验证码**，故保持 `enabled: false` |
| 猎聘 `liepin` | 浏览器 | ❌ 不可自动化（双重拦截） | ①首页/搜索页渲染约 2.5 秒后被站点脚本重置为 `about:blank`；②出口 IP 被标记进 `safe.liepin.com/intercept/ip/captcha` 验证码通道（**纯 HTTP 请求即被 302，与 Cookie、浏览器指纹无关**）。已定案关闭，见第二节 |
| 中国水利工程协会 `cweun` | HTTP | ✅ 可解析 | GBK 站点；栏目为协会动态，招聘公告命中率低，默认开启用于兜底 |
| 江苏省水利厅·通知公示 `jswater` | HTTP | ✅ 可解析 | 已验证列表结构；当前栏目招聘类公告少 |
| 水利英才网 / 中国水利人才网（旧域名） | — | ❌ 具体域名已失效 | `shuilihr.com`、`waterhr.net` 均已无法解析。注意：**现役域名是 `waterhr.com`**（已接入，见上表），勿与失效域名混淆 |
| 建筑英才网 `buildhr` | — | ❌ 不可合规抓取 | 真实职位列表只在 `/so/`（robots 明确 `Disallow: /so/`）；`/job`、`/navigation` 为 JS 空壳（职位链接 0 个），`/jobs` 返回 429 限流。故不接入 |
| 山东·招考录用 `shandong_zkly` | HTTP(公告) | ✅ 可用 | 省厅**招考录用**栏目，纯服务端 HTML（30 条/页），**标题即招聘公告**。实测：30 条 → 命中 14 条（水利职业学院/水文中心等公开招聘）。注：站方自己把列表标题截断成 `…2026...`，完整标题要点开链接 |
| 广东·人事信息 `guangdong_rsxx` | HTTP(公告) | ✅ 可用 | 省厅**人事信息**栏目（20 条/页），几乎全是事业单位公开招聘/选调/公务员。实测：20 条 → 命中 1 条（招聘集中在招考季） |
| 四川·公示公告 `sichuan_gsgg` | HTTP(公告) | ✅ 可用 | 含直属事业单位公开考核招聘公告。实测：22 条 → 命中 2 条 |
| 安徽·通知公告 `anhui_tzgg` | HTTP(公告) | ✅ 可用 | 15 条/页；以造价工程师注册/资质类公告为主，招聘占比低 |
| 陕西·通知公告 `shaanxi_tzgg` | HTTP(公告) | ✅ 可用 | 15 条/页；以资质评审/验收公告为主 |
| 福建·通知公告 `fujian_tzgg` | HTTP(公告) | ✅ 可用 | 75 条/页；多为采购比选/公示，招聘占比最低（实测 0 命中），作兜底 |
| 湖北/云南/浙江/湖南水利厅 | — | ❌ 未接入 | 湖北 `slt.hubei.gov.cn` 返回 **412**（云 WAF）；云南 `slt.yn.gov.cn` 域名不可达；浙江人事信息栏目仅 1.6KB、湖南通知公告栏目均为 **JS 渲染**。湖南「人事信息」虽静态但内容全是任免/退休通知，无招聘价值 |
| 国聘 `iguopin.com` | — | ❌ 不接入（需签名逆向） | 央企国企招聘平台。robots 全放行、SPA 可访问，但职位列表接口 `POST api4.iguopin.com/api/jobs/v3/list` 强制要求 `Sign`/`T`/`Nonce` 三个签名头（签名用 bundle 内硬编码密钥 + 时间戳算出，见 `main.*.js` 的 axios 请求拦截器），裸调一律返回 `data:null`。**接入必须逆向其请求签名算法——属本项目明令禁止的 token 逆向**，故放弃 |
| 任意自定义渠道 | HTTP | ✅ 配置即可 | 见下文「三、新增渠道」 |

> 招聘类站点普遍有反爬与登录限制。本程序**不绕过验证码、不伪造登录态**，遇到风控只记录日志并跳过；请勿高频抓取。

## 二、登录态（需要登录的渠道）

程序**不绕过验证码、不伪造账号**：会话由你本人登录产生，程序只是复用。

先说结论：**BOSS 与猎聘 无法用自动化浏览器采集**。实测（无头/有头、内置 Chromium/本机 Chrome、关不关 `navigator.webdriver` 都试过）：

| 站点 | 自动化浏览器的实际表现 |
| --- | --- |
| BOSS 首页 / 搜索页 | 跳转到 `…/passport/zp/verify.html`「安全验证」**滑块页** |
| BOSS 登录页 | 渲染后立刻被重置为 `about:blank` |
| 猎聘 搜索页 / 首页 | 正常渲染约 2.5 秒 → 被站点脚本重置为 `about:blank` |
| 猎聘 登录页 | 早期可正常渲染；出口 IP 被标记后直接 302 到 `…/intercept/ip/captcha` 验证码通道 |
| 前程无忧 51job（对照） | 正常渲染，✅ 可用 |

### 猎聘为什么不再尝试（2026-10-02 实测定案）

猎聘有两套**互相独立**的防线，任一条都足以判死，且第一条与本项目原则直接冲突：

1. **JS 反自动化**：首页与搜索页渲染约 2.5 秒后被页面脚本自行重置为 `about:blank`。越过它需要指纹伪装或行为仿真——本程序不做。
2. **出口 IP 风控**：登录页与搜索页被 302 到 `safe.liepin.com/`**`intercept/ip/captcha/`**`dispatch`。这条判定的是 IP，**用纯 HTTP 请求（无浏览器、无 JS）复现同样被 302**，所以它**与 Cookie 无关**：即便持有全新有效的登录态，请求在服务端被读 Cookie 之前就已经被转到验证码通道。

由此得两个结论：

- **Cookie 导入对猎聘不可能奏效**——不是"可能失败"，而是请求根本到不了目标页。`--cookie-file` 通道保留备用（未来若新增其他需登录渠道可直接用），但对 BOSS/猎聘 均已无意义。
- **不要反复重试**：每次尝试都在给该出口 IP 继续加分。本机 IP 是 2026-10-02 上午多轮探测后进入验证码通道的（10:29 登录页尚可渲染，约 45 分钟后被拦），IP 标记通常会随时间衰减。

> **2026-10-03 复测记录（搁置结论的依据）**：出口 IP 的验证码拦截已自行解除（搜索页/登录页纯 HTTP 请求恢复 `200`），但**渠道仍不可用，故维持 `enabled: false` 搁置**，理由有三：
> ① 第一条防线未变——自动化浏览器里页面仍是渲染约 2.5 秒后自毁，越过它需要规避手段；
> ② 登录页能访问≠能取到会话——猎聘检测开发者工具，在本人 Chrome 里按 F12 同样自毁（已实测），Cookie 导出这条路走不通；
> ③ 搜索页 URL（`/zhaopin/?key=…`）命中 robots 的 `Disallow: /*?*`，即使技术上能抓也不做。
> 若将来要重新评估，需同时解决 ①②③；只解决 IP 或只解决 Cookie 都无意义。

> **另一个容易踩的坑（与自动化无关）**：猎聘会检测开发者工具，**在你自己日常的 Chrome 里登录后按 F12，页面同样会跳成 `about:blank`**，导致"F12 → Network → 复制 Cookie"这条路在猎聘上根本走不通。若将来真要用它，得改用 Firefox（反调试脚本通常只针对 Chrome）或不打开 DevTools、改用 CDP 从外部读取会话 Cookie。

**BOSS 能不能"人工手动过滑块"？** 机制上允许（由你在可见窗口里手动完成，程序不代做、不破解），但实测对 BOSS 行不通：自动化浏览器里 BOSS 首页/登录页都会被重置成 `about:blank`，根本没有可操作的界面（偶尔刷出滑块页也会很快被重置）。

```bash
# 会话导入通道（BOSS/猎聘 当前实测均不可用，保留给未来的新渠道）
# 1) 在自己日常的 Chrome 里正常登录该网站（不要用自动化浏览器）
# 2) F12 → Network → 刷新 → 点第一个文档请求 → Request Headers → 复制整条 Cookie 的值
# 3) 存成一个文本文件（内容形如 name1=value1; name2=value2），然后导入：
npm run jobs:login -- <渠道> --cookie-file cookies.txt
npm run jobs:login -- <渠道> --check      # 校验：有效 exit 0，无效 exit 2
```

`npm run jobs:login -- <渠道>` 不带参数则是**人工登录模式**：打开该站点首页（而非会被重置的登录页）→ 提示你手动过滑块/登录 → 按回车后保存登录态并**立即校验**，直接告诉你是否可用。

> 为什么用文件而不用命令行直接传：Windows 的 cmd 会把 `;` 当作参数分隔符，直接粘贴 Cookie 字符串会被截断（这个坑我们实测踩过），所以统一走 `--cookie-file`。

其他说明：

- 登录态保存为 `data/jobs/auth/<渠道>.json`（Playwright storageState），采集时自动加载；文件不存在则退回游客态并在日志提示。
- **安全提醒**：该文件等同你的登录凭证，`data/` 已在 `.gitignore` 中，请勿拷给他人、勿提交到任何仓库；不需要时直接删除即可失效。导入命令只回显 Cookie 名，不回显值。
- **失效处理**：采集日志会提示 `登录态可能已失效，请重新执行: npm run jobs:login -- <渠道>`；重新导入一次即可，同一渠道的会话被所有关键词查询复用。
- **能否成功仍取决于站点是否放行**：即使带上你的真实会话，猎聘仍有可能继续自毁页面、BOSS 仍可能弹滑块。需要开启时把 `config.json` 里对应渠道的 `enabled` 改为 `true` 再实跑一轮看结果。
- **风控提示**：这类站点对自动化访问敏感，建议 `maxPages` 保持 1–2、每天最多 1 次；账号出现异常提示时立即停用。

## 三、字段与输出

每条记录字段：`title` 职位名称、`company` 招聘单位、`location` 工作地点、`salary` 薪资待遇、`publishedAt/publishedText` 发布时间、`url` 详情链接，另附 `category` 方向、`keyword` 命中关键词、`tags` 标签（经验/学历/技能）、`id` 去重主键、`firstSeenAt` 首次发现时间。

输出到 `data/jobs/`（已在 `.gitignore` 中，不入库）：

| 文件 | 用途 |
| --- | --- |
| `jobs.jsonl` | 全量增量历史，每行一条，永不覆盖 |
| `jobs.json` | 最新快照（默认按发布时间倒序保留 2000 条），供程序消费 |
| `jobs.csv` | 带 BOM 的表格，Excel 双击即开不乱码 |
| `jobs.md` | 按监理/施工/公告分组的 Markdown 表格，适合直接阅读 |
| `seen.json` | 去重状态（岗位主键 + 内容指纹） |
| `runs.jsonl` | 每轮运行摘要（含 `added` / `pushed`），供 `npm run jobs:stats` 分析稳定性 |
| `logs/jobs-YYYY-MM-DD.log` | 按天日志（本地时间命名），默认保留 14 天 |

### 微信推送

每轮落盘后，把**本轮新增**岗位汇总成一条消息推送到微信：

| 项 | 说明 |
| --- | --- |
| 推送范围 | 只推本轮新增（去重后的），**历史岗位不重推**——否则每天都是同一批岗位 |
| 条数上限 | `jobs.push.limit`（默认 10，未设时回退顶层 `pushLimitPerRun`），超出部分只报总数；微信对长文本会截断 |
| 分组 | 按方向（监理/施工/其他）分组，每条为「标题（可点击）+ 单位·地点·薪资·日期」 |
| token | 复用顶层 `pushplusToken`；也可单给 `jobs.push.token` 或用 `PUSHPLUS_TOKEN` 环境变量 |
| 关闭 | `jobs.push.enabled: false`，或单次加 `--no-push` |
| 失败处理 | 推送失败只记日志，**不影响已落盘的结果**（先落盘、后推送） |

```bash
node src/jobs/notify.test.js   # 推送内容格式与 HTML 转义自测
JOBS_PUSH_LIMIT=5 npm run jobs # 临时只列 5 条
```

## 四、关键词与有效期

### 关键词分两层

避免"互联网总监""房产资料员"被误收：

1. **强词**：自带行业属性（如 `水利监理`、`总监理工程师`、`水利资料员`），单独命中即可；
2. **弱词**：泛岗位词（`监理`、`总监`、`资料员`、`项目经理`…），必须与**行业词**（`水利/水电/水工/河道/灌区/泵站/水库/堤防/大坝`…）同现才收录。

行业词判定会排除平台的**多行业合并分类标签**（如智联的 `电力/水利/热力/燃气`）——它表示平台分类而非岗位内容，否则电力、市政岗位会被大量误收。招聘单位名参与行业判定（如"XX水利工程有限公司"）。

命中后按方向归类为 `监理` / `施工` / `监理+施工`；公告类渠道按"招聘类词 + 行业词"收录。

配置：环境变量 > `config.json` 的 `jobs.directions/industryWords/excludeKeywords` > 内置默认。回归自测：

```bash
node src/jobs/keywords.test.js   # 19 个真实样本（含反例）全部通过
```

### 有效期过滤（默认半年）

招聘信息生命周期短，**过期岗位推出去就是纯噪声**，因此在关键词命中后还要过一层时间过滤：

- `jobs.maxAgeDays`（默认 `180`）：发布时间早于 N 天的岗位直接丢弃，运行摘要里记为 `过期(早于180天)`。收紧到 3 个月改成 `90`，或用环境变量临时生效：`set JOBS_MAX_AGE_DAYS=90`。
- `jobs.keepUndated`（默认 `true`）：无发布时间的条目保留。公告类页面常不给日期，全部丢弃会漏掉真实招聘；设为 `false` 则“未提供日期的一律不收”。
- 时间来源：智联走详情页取权威发布时间，51job 取 `jobTime`，其余取列表页日期。
- 智联列表页无日期，只有被详情页补全（`detailMaxPerRun`，默认每轮 15 条）的条目才有发布时间；想更快补全可调大该值（代价是每轮耗时增加，每条约 3 秒）。

自测：`node src/jobs/fresh.test.js`（11 个边界用例，含闰月边界、无日期、`maxAgeDays=0` 关闭过滤）。

## 五、定时运行

`config.json` 的 `jobs.schedule`：

```json
{ "enabled": true, "runOnStart": true, "mode": "interval", "intervalHours": 24, "at": ["08:30"] }
```

- `mode: "interval"`：每 `intervalHours` 小时执行一次（默认 24 = 每天）
- `mode: "daily"`：每天固定时刻执行，`at` 可写多个如 `["08:30","20:00"]`
- 常驻进程：`npm run jobs:schedule`；只跑一轮后退出：`node src/jobs/scheduler.js --once`
- 单实例锁 `data/jobs/.scheduler.lock` 防止重复采集；分片睡眠，系统休眠唤醒后不会错过计划点
- Windows 计划任务示例（每天 8:30 跑一次，跑完退出）：

```cmd
schtasks /create /tn "水利招聘采集" /tr "cmd /c cd /d C:\Users\18858\MonkeyCode\wechat-ai-push && node src\jobs\scheduler.js --once" /sc daily /st 08:30
```

## 六、稳定性设计

| 风险 | 处理方式 |
| --- | --- |
| 单站请求失败 | 最多重试 2 次，指数退避 + 随机抖动；4xx（403/404）不重试 |
| 被反爬/限流 | 请求间隔随机 2–5 秒、并发上限 2、正常 UA；不做绕过 |
| 某渠道整体失效 | 只记录该渠道错误，其余渠道与落盘流程照常 |
| 页面结构变化 | 解析全部容错：正则不匹配返回空数组而非抛错；抓取数为 0 时日志打印页面标题辅助排查 |
| 结果重复 | 两级去重：岗位主键 + （单位+岗位+地点）内容指纹，状态保留 180 天 |
| 时间字段缺失 | 发布时间缺失时留空并记录 `firstSeenAt`；智联走详情页补权威发布时间 |
| 过期岗位 | 超过 `maxAgeDays`（默认 180 天）的岗位直接丢弃，不占用推送位 |
| 无人值守观察 | `jobs:stats` 汇总历史运行，出现"抓取数为 0"会显著提示 |

## 七、新增渠道（配置驱动，不改代码）

在 `config.json` 的 `jobs.sites` 里加一段即可（示例见 `config.example.json`）：

```json
"mySite": {
  "enabled": true,
  "name": "某省水利厅人事处",
  "sourceType": "notice",
  "encoding": "gbk",
  "listUrl": "http://example.gov.cn/rsxx/index_{page}.html",
  "maxPages": 2,
  "rule": {
    "segmentPattern": "<li[^>]*>([\\s\\S]{0,500}?)</li>",
    "itemPattern": "<a[^>]+href=\"([^\"]+)\"[^>]*>([\\s\\S]{4,120}?)</a>",
    "urlTemplate": "http://example.gov.cn{href}",
    "titleGroup": 2,
    "hrefGroup": 1
  }
}
```

- `itemPattern` 中 `hrefGroup`/`titleGroup` 是捕获组序号；`segmentPattern` 用于先切出含发布日期的列表行
- `urlTemplate` 用 `{href}` 补全相对链接
- 调试：先 `node src/jobs/index.js --site=mySite --dry-run` 看解析条数与日志

浏览器渠道（JS 渲染站点）比照 `jobs.sites.51job` 配置：`attrExtract`（读元素属性里的 JSON，最稳）或 `selectors`（按 DOM 文本抽取）。需要登录的渠道再加 `requiresLogin` / `loginUrl` / `storageState` 三项，然后 `npm run jobs:login -- <渠道>` 生成登录态。

若新站是**省厅公告列表**且结构与已有省厅相同（`<li>` 行内含发布日期），不必新写规则：直接复用 `src/jobs/config.js` 里的 `PROV_NOTICE_RULE` 常量（只填 `listUrl` + `maxPages: 1`）。注意该规则的标题长度上限为 600——部分政府 CMS 在 `<a>` 与标题间插入大段缩进空白，上限过小会整站解析为 0 条。

若新站是**纯 HTTP 且结构固定**的垂直站（比照 `job2299`、`zhaopin`、`jianlihr`、`waterhr`）：在 `src/jobs/adapters/` 下新增一个适配器（导出 `parseList`/`fetchPages`），并在 `src/jobs/index.js` 的 `HTTP_ADAPTERS` 里登记一行。若该站**没有关键词搜索**、只能按整站列表翻页（如 `job2299`），额外导出 `queryless: true`，采集器就只抓一次列表、不会按关键词重复抓同一批内容。

新增适配器后，建议在 `src/jobs/adapters.test.js` 里用「实测抓到的真实 HTML 片段」补一条解析回归用例（该文件已覆盖 `jianlihr`/`waterhr`、`rencai` 与省级水利厅 `PROV_NOTICE_RULE` 的公告规则）：

```bash
node src/jobs/adapters.test.js   # 网站改版导致解析失效时，先于线上采集报警
```

## 八、合规提醒

仅用于个人求职信息聚合。请遵守目标网站的 robots.txt 与服务条款，保持低频访问；不要用于商业抓取或批量分发。程序默认限速、默认按有效期过滤，并禁用未验证成功的渠道。

### robots.txt 实测（2026-10-02 ~ 10-04，直接取自各站，非转述）

| 渠道 | robots.txt 关键内容 | 判定 |
| --- | --- | --- |
| 智联 `sou.zhaopin.com` | `Disallow: /` | ❌ 全站禁止（当前仍在用，见下） |
| BOSS `www.zhipin.com` | `Disallow: /*?query=*`、`/*?*` | ❌ 搜索页禁止 |
| 猎聘 `www.liepin.com` | `Disallow: /*?*`、`/user/` | ❌ 搜索页与登录页禁止 |
| 前程无忧 `we.51job.com` | 无 robots.txt（返回 SPA 404） | ⚪ 无明确指令 |
| 工程监理人才网 `www.job2299.com` | `User-agent: *` + `Disallow:`（空） | ✅ 允许抓取 |
| 监理招聘网 `www.jianlihr.com` | 禁止 58 项，均为简历/管理路径（`/resume*`、`/allresume*`、`/corpmanage*`、`/rencaimanage*`） | ✅ 公开职位页与关键词页未被禁 |
| 水利英才网 `www.waterhr.com` | 仅禁 4 项管理路径（`/myNew/`、`/my/`、`/adminNew/`、`/webdev/`） | ✅ 公开职位页未被禁 |
| 中国水利人才网 `rencai.mwr.cn` | robots 取不到（无明确指令） | ⚪ 无明确指令 |
| 安徽省水利厅 `slt.ah.gov.cn` | 无 robots.txt（404） | ⚪ 无明确指令 |
| 山东省水利厅 `wr.shandong.gov.cn` | robots 取不到（请求超时） | ⚪ 无明确指令 |
| 广东省水利厅 `slt.gd.gov.cn` | 无 robots.txt（404） | ⚪ 无明确指令 |
| 四川省水利厅 `slt.sc.gov.cn` | 无 robots.txt（404） | ⚪ 无明确指令 |
| 陕西省水利厅 `slt.shaanxi.gov.cn` | 无 robots.txt（404） | ⚪ 无明确指令 |
| 福建省水利厅 `slt.fujian.gov.cn` | `Disallow:`（空） | ✅ 允许抓取 |
| 湖南省水利厅 `slt.hunan.gov.cn` | `Disallow:`（空） | ✅ 允许抓取（但栏目为 JS 渲染，未接入） |
| 国聘 `www.iguopin.com` | `User-agent: *` + `Disallow:`（空） | ✅ 允许抓取（但接口需签名，未接入） |
| 建筑英才网 `www.buildhr.com` | 禁止 179 项，含 **`Disallow: /so/`**（真实职位列表所在路径） | ❌ 列表路径被禁，故不接入 |
| 中国水利工程协会 `www.cweun.org` | 无 robots.txt（IIS 404） | ⚪ 无明确指令 |
| 江苏省水利厅 `jswater.jiangsu.gov.cn` | robots 被云 WAF 403（取不到） | ⚪ 无明确指令 |

复查命令（结论会随站点调整变化，建议每隔一段时间重查）：

```bash
curl -s https://sou.zhaopin.com/robots.txt
curl -s https://www.zhipin.com/robots.txt
curl -s https://www.liepin.com/robots.txt
```

### 现状与取舍（明确记录，避免以后误以为"没查过"）

- **智联**：robots 为 `Disallow: /`，但仍在启用。理由是量级——每天 1 次、每次 2–3 页、请求间隔随机 2–5 秒、只取公开岗位字段（标题/单位/地点/薪资/时间，不碰简历与联系方式），属个人求职用途。**这是知情后的取舍，不是疏漏**。若将来要提高频率或扩大规模，需重新评估：robots.txt 本身是行业约定，真正触发法律风险的是破解技术措施、批量获取个人信息、影响服务正常运行三件事，而"量级"正是这三者的分界线。
- **BOSS / 猎聘**：除 robots 明确禁止搜索结果页外，两者还会拦截自动化浏览器（BOSS 跳安全验证滑块页或 `about:blank`，猎聘渲染约 2.5 秒后自行重置为 `about:blank`）。因此**不做指纹伪装、不做 token 逆向、不做 Cookie 池**——这三类都属绕过站点技术措施。若确有必要，只走"靠自己账号登录 + 手工导入会话"的低频个人路径（见第二节），并自行承担平台风控与账号风险。
- **登录态渠道通用**：登录态文件是你的个人凭证，泄露等于账号泄露；平台风控可能因自动化访问限制账号，请自行评估风险并保持低频。
