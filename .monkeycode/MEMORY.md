# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-09
- Context: Discovered by Agent while building a WeChat push service that aggregates latest articles from top AI media accounts
- Category: Troubleshooting & Debugging
- Instructions:
  - 微信公众号没有公开文章列表 API；数据中心网络环境下，搜狗微信搜索返回 antispider 验证码页、二十次幂/cimidata 搜索需登录、RSSHub 公共实例的 wechat 路由全部 503/禁用、feeddd 已关停。这些渠道均不可用于自动化抓取，且绕过验证码属违规。
  - 可行的替代数据源是头部 AI 自媒体的官网：量子位 qbitai.com（WordPress，文章链接格式 /YYYY/MM/ID.html，标题在 <a> 内）、智东西 zhidx.com（链接 /p/ID.html）、新智元 aiera.com.cn（WordPress，文章链接 /YYYY/MM/DD/other/admin/{id}/{slug}/）、36氪 gateway.36kr.com/api/mis/nav/home/nav/rank/hot（POST JSON 返回 hotRankList，含 widgetTitle/publishTime/authorName，详情 URL https://www.36kr.com/p/{itemId}）、InfoQ infoq.cn（首页 Nuxt SSR 数据，热榜在 __NUXT_DATA__ 的 home-base.hotList.day，标题字段是 article_title 而非 title，文章 URL 为 /article/{aid}）。机器之心官网已改版为展示页，无公开文章流；虎嗅有阿里云 WAF 防护不可抓；极客公园根路径返回 403。
  - 36氪热榜 API 必须用 POST + JSON body，且请求头 Accept 不能是 text/html（会返回 code:10 系统异常），应使用 */* 或省略。
  - InfoQ 的 __NUXT_DATA__ 是带引用索引的 JSON 数组结构（整数值可能是字面量也可能是数组索引引用），解析对象字段时仅当被引用的元素是 string/object 才递归 resolve，否则保留字面量，且需用 Set 防循环引用、限制深度。
  - pushplus 推送接口：POST https://www.pushplus.plus/send，body 为 {token, title, content, template:'html'}，返回 code===200 表示成功。

[Project Knowledge Summary]
- Date: 2026-08-13
- Context: Discovered by Agent while deploying wewe-rss (v2.6.1) as a self-hosted WeChat official-account RSS source and wiring it into the push service
- Category: Operations & Deployment
- Instructions:
  - wewe-rss（cooderl/wewe-rss v2.6.1）可自建为公众号 RSS 源：克隆到 /tmp/opencode/wewe-rss，pnpm install 后需先手动跑二进制（新版 pnpm 忽略 pnpm.onlyBuiltDependencies 失效），prisma 5.22.0 的 CLI 要直接调 node node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js（npx 会拉 7.9.1 不兼容）；SQLite 模式（DATABASE_URL=file:../data/wewe-rss.db）迁移与构建成功后再启动。
  - 启动 wewe-rss：AUTH_CODE 作为 tRPC 鉴权头，SERVER_ORIGIN_URL 必须设为公网 preview 域名（如 https://4000-xxxx.monkeycode-ai.online）而非 localhost，否则前端 tRPC Failed to fetch；运行于 4000 端口，SQLite 库在 apps/server/data/wewe-rss.db。
  - 微信读书扫码登录：tRPC mutation platform.createLoginUrl（POST）返回 {uuid, scanUrl}；轮询 GET /trpc/platform.getLoginResult?batch=1&input=<urlencoded {"0":{"id":uuid}}>，Authorization 头=AUTH_CODE；成功时返回 message:success + vid/token/username。前端页面 bug：onSuccess 对所有 message 都报「登录失败」且 waiting 状态白遮罩盖住二维码（apps/web/src/pages/accounts/index.tsx 需修复并重构建 web）。前端不可靠时可用独立 Node 服务（express+qrcode，/tmp/opencode/qrlogin/server.js）直接调 createLoginUrl 生成二维码 dataURL 并轮询 getLoginResult。
  - 重要：该 tRPC 服务用 initTRPC.create() 默认 identity transformer（非 superjson），POST mutation 请求体必须是 {"0":{...}}（batch=1），不能带 {"json":...} 包装，否则 input 解析为 undefined 报 invalid_type。
  - 扫码成功并拿到 vid/token/username 后，需调 account.add（body {"0":{"id":vid,"name":username,"token":token}}）把账号写入数据库，仅 getLoginResult 返回 success 不会保存账号；重复轮询导致 upsert 报 id undefined 属正常误报，账号已保存。
  - 订阅公众号：platform.getMpInfo 是 mutation，参数是 wxsLink（https://mp.weixin.qq.com/s/... 开头），返回公众号 id/name/cover/intro；再用 feed.add（body {"0":{"id","mpName","mpCover","mpIntro","updateTime"}}）订阅，之后 feed.refreshArticles（body {"0":{"mpId"}}）同步文章，RSS 输出为 /feeds/{mp_id}.rss（RSS 2.0）。
  - 已订阅公众号：机器之心 MP_WXS_3073282833、虎嗅APP MP_WXS_1432156401；登录账号「扬帆起航的墙」id=431803268。
  - 极客公园经免费公众号 RSS 服务 wechat2rss（wechat2rss.xlab.app）获取，feed 地址含 hash，OPML 列表在 /opml/sec.opml；wechat2rss 的 RSS 用纯文本 title，wewe-rss 的 RSS 用 CDATA 包裹 title，parseRss 必须先在 cleanTitle 剥离 CDATA（/<!\[CDATA\[([\s\S]*?)\]\]>/g），否则整段被当标签删除导致 0 条。
  - 主推送服务选文逻辑：fresh 数组按源顺序排列时，前几个源会占满 pushLimitPerRun 名额导致后续源永不入选；应改为按源轮询（每源每轮取一篇，每源上限 perSourceLimit，总数上限 pushLimitPerRun）以均衡覆盖全部源。

[Project Knowledge Summary]
- Date: 2026-08-13
- Context: Discovered by Agent while auditing security of the WeChat push service, wewe-rss deployment, and GitHub push
- Category: Environment Configuration & Security
- Instructions:
  - 敏感文件权限须加固为 600：/workspace/config.json（pushplus token）、/workspace/data/sent.json 与 lastrun.json、/tmp/opencode/wewe-rss/apps/server/data/wewe-rss.db（含微信读书 token）。这些文件已 gitignore 不入库。
  - GitHub push 时若 token 直接拼进 git remote URL（https://x-access-token:TOKEN@...），会明文存于 .git/config，push 后须立即 git remote set-url 恢复为 https://github.com/用户/仓库.git，避免 token 长期残留。
  - wewe-rss 安全边界：所有 /trpc/* 接口（含 account.add、feed.add 等）受 AUTH_CODE 保护，公网无鉴权调用返回 401；但 /feeds/* 的 RSS 输出为公开无鉴权（官方默认行为），只含文章标题+链接，不含微信读书 token，无隐私泄露。
  - 扫码登录独立服务（/tmp/opencode/qrlogin，4500 端口）只能创建登录二维码与轮询状态，无法读取已有账号数据，登录完成后应停止该服务缩小攻击面。
  - 环境内 GitHub 凭据需用用户提供的 Personal Access Token；gh auth login 需要 read:org scope（classic token 只勾 repo 会报 missing scope），git 直连 https://api.github.com 配 Authorization: token 头可用。仓库创建：POST /user/repos 传 {name, private, description}。
