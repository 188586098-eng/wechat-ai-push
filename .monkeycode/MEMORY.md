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
  - wewe-rss（cooderl/wewe-rss v2.6.1）可自建为公众号 RSS 源：克隆到 /tmp/opencode/wewe-rss，pnpm 11 已改用 pnpm-workspace.yaml 的 allowBuilds 字段（如 allowBuilds: {prisma: true, '@nestjs/core': true, esbuild: true, '@prisma/client': true, '@prisma/engines': true}），package.json 的 pnpm.onlyBuiltDependencies 已被忽略（WARN: no longer read by pnpm），不配 allowBuilds 则 pnpm install 报 ERR_PNPM_IGNORED_BUILDS 且后续 build/start 会失败。
  - SQLite 模式部署：先 mv apps/server/prisma 为备份、mv apps/server/prisma-sqlite apps/server/prisma（官方流程要求切换 schema 目录），然后 DATABASE_URL=file:../data/wewe-rss.db node node_modules/.pnpm/prisma@5.22.0/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma 建表，再 generate --schema prisma/schema.prisma 生成 client，最后 pnpm build && DATABASE_URL=file:../data/wewe-rss.db DATABASE_TYPE=sqlite node dist/main 启动；prisma CLI 直接用 lock 版本 node 调 build/index.js（npx 会拉错版本不兼容），实际 lock 内 prisma 为 5.22.0、@prisma/client 为 5.10.1（版本不匹配 warning 可忽略，能正常工作）。
  - 启动 wewe-rss：AUTH_CODE 作为 tRPC 鉴权头，SERVER_ORIGIN_URL 必须设为公网 preview 域名（如 https://4000-xxxx.monkeycode-ai.online）而非 localhost，否则前端 tRPC Failed to fetch；运行于 4000 端口，SQLite 库在 apps/server/data/wewe-rss.db。
  - 微信读书扫码登录：tRPC mutation platform.createLoginUrl（POST）返回 {uuid, scanUrl}；轮询 GET /trpc/platform.getLoginResult?batch=1&input=<urlencoded {"0":{"id":uuid}}>，Authorization 头=AUTH_CODE；成功时返回 message:success + vid/token/username。前端页面 bug：onSuccess 对所有 message 都报「登录失败」且 waiting 状态白遮罩盖住二维码（apps/web/src/pages/accounts/index.tsx 需修复并重构建 web）。前端不可靠时可用独立 Node 服务（express+qrcode，/tmp/opencode/qrlogin/server.js）直接调 createLoginUrl 生成二维码 dataURL 并轮询 getLoginResult。
  - 重要：该 tRPC 服务用 initTRPC.create() 默认 identity transformer（非 superjson），POST mutation 请求体必须是 {"0":{...}}（batch=1），不能带 {"json":...} 包装，否则 input 解析为 undefined 报 invalid_type。
  - 扫码成功并拿到 vid/token/username 后，需调 account.add（body {"0":{"id":vid,"name":username,"token":token}}）把账号写入数据库，仅 getLoginResult 返回 success 不会保存账号；重复轮询导致 upsert 报 id undefined 属正常误报，账号已保存。
  - 订阅公众号：platform.getMpInfo 是 mutation，参数是 wxsLink（https://mp.weixin.qq.com/s/... 开头），返回公众号 id/name/cover/intro；再用 feed.add（body {"0":{"id","mpName","mpCover","mpIntro","updateTime"}}）订阅，之后 feed.refreshArticles（body {"0":{"mpId"}}）同步文章，RSS 输出为 /feeds/{mp_id}.rss（RSS 2.0）。
  - 已订阅公众号：机器之心 MP_WXS_3073282833、虎嗅APP MP_WXS_1432156401；登录账号「扬帆起航的墙」id=431803268。
  - 极客公园经免费公众号 RSS 服务 wechat2rss（wechat2rss.xlab.app）获取，feed 地址含 hash，OPML 列表在 /opml/sec.opml；wechat2rss 的 RSS 用纯文本 title，wewe-rss 的 RSS 用 CDATA 包裹 title，parseRss 必须先在 cleanTitle 剥离 CDATA（/<!\[CDATA\[([\s\S]*?)\]\]>/g），否则整段被当标签删除导致 0 条。
  - 主推送服务选文逻辑：fresh 数组按源顺序排列时，前几个源会占满 pushLimitPerRun 名额导致后续源永不入选；应改为按源轮询（每源每轮取一篇，每源上限 perSourceLimit，总数上限 pushLimitPerRun）以均衡覆盖全部源。
  - 重新订阅公众号时若找不到可用 wxsLink（getMpInfo 的入参必须是 https://mp.weixin.qq.com/s/ 开头），可直接用已知 mpId 调 feed.add（body {"0":{"id":mpId,"mpName":...,"mpIntro":...,"updateTime":...}}）也能完成订阅；调 feed.refreshArticles 后 RSS 即出文章。平台.getMpArticles 可能返回空 []，应以 /feeds/{mp_id}.rss 输出为准判断订阅是否生效。机器之心 wxsLink 可从搜索结果的 mp.weixin.qq.com/s/ 链接获取（如 A5XZbSn4AYWoOqNB3R7DPg），虎嗅直接 mpId=MP_WXS_1432156401 订阅。

[Project Knowledge Summary]
- Date: 2026-08-17
- Context: Discovered by Agent while adding auto re-login for wewe-rss account in the push service
- Category: Troubleshooting & Debugging
- Instructions:
  - wewe-rss 账号 token 失效时不会自动恢复：getMpArticles 遇 401（WeReadError401）会把账号 status 置 0 并加入当日 blockedAccountsMap，getAvailableAccount 只挑 status=1 且不在 blocked 列表的账号，导致所有订阅刷新失败、推送停留在旧文。修复需重新扫码换 token 并调 account.edit（body {"0":{"id":...,"data":{"token":...,"status":1}}}）——该接口会自动 removeBlockedAccount，无需重启服务。
  - 推送前自检流程（/workspace/src/auth.js）：先调 tRPC query account.byId（注意是 GET + input 参数，POST 会报 No mutation-procedure）拿 status/token，再用平台接口 GET https://weread.111965.xyz/api/v2/platform/mps/MP_WXS_3073282833/articles?page=1 带 xid + Bearer token 验证（401=失效）。失效时 createLoginUrl → qrcode 生成 dataURL → pushplus 推送 HTML 二维码消息 → 轮询 getLoginResult（GET + input，服务端最长阻塞 120s，客户端 fetch 需 70s 超时并吞掉轮询异常）→ 扫码成功后 account.edit 更新 token+status=1 → feed.refreshArticles 全量刷新。
  - tRPC query 与 mutation 调用格式不同：query 用 GET /trpc/{path}?batch=1&input=<urlencoded {"0":input}>，mutation 用 POST /trpc/{path}?batch=1 body={"0":input}；响应取 json[0].result.data，error 取 json[0].error.message。
  - config.json 中新增 weweRssUrl/weweAuthCode/platformUrl/weweAccountId 四个字段供 auth.js 读取，推送服务每次运行前都做 token 自检（不做小时缓存，避免失效后仍跳过检测）。

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

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while implementing cloud (GitHub Actions) scheduled push and local token maintenance workflow
- Category: Operations & Deployment
- Instructions:
  - 云端方案（GitHub Actions）：/workspace/.github/workflows/ai-news.yml 每天北京时间 7:00（cron '0 23 * * *' 即 UTC 23:00）自动运行，workflow_dispatch 可手动触发。运行逻辑在 /workspace/gh-actions/（index.js/fetch.js/sources.js/llm.js/push.js/wechat.js/health.js），直接调微信读书平台 API（weread.111965.xyz/api/v2/platform/mps/{mpId}/articles）抓 8 个公众号，不跑 wewe-rss。
  - 关键：GitHub Actions 内无法扫码续期——runner 无法运行 wewe-rss、平台 API 不暴露 tRPC 登录端点（/trpc/* 全部 404）、GitHub Secrets 只读无法写回。因此 token 失效只能本机扫码后手动同步。
  - 健康检测与降级：gh-actions/health.js 每次运行先探测 token（401=失效）。失效时自动降级为纯官网源日报（推送不断更），并 pushplus 推送「微信读书登录已失效」提醒含续期指引；有效时输出 [健康] 公众号 token 有效。health.js 的 PLATFORM_URL/WEWE_TOKEN/WEWE_XID 在函数内读取 process.env（模块加载时读取会导致测试时设置 env 无效）。
  - 本机一键同步：/workspace/sync-secret.sh 从本地 wewe-rss 库（/tmp/opencode/wewe-rss/apps/server/data/wewe-rss.db 的 accounts 表，账号 id=431803268）读取 token，用 gh secret set WEWE_TOKEN --repo 188586098-eng/wechat-ai-push 更新到 GitHub Secret。依赖 gh CLI（需 GH_TOKEN 环境变量或已 gh auth login），token 不落盘。
  - 已配置的 GitHub Secrets：PUSHPLUS_TOKEN、USER_LLM_API_KEY、WEWE_TOKEN（3 个必填）；USER_LLM_BASE_URL/USER_LLM_MODEL/WEWE_XID/PLATFORM_URL 因代码有默认值未配置。
  - 本机 token 维护（云端关闭也自给自足）：本地 wewe-rss（localhost:4000）+ qrlogin（localhost:4500，/tmp/opencode/qrlogin/server.js）+ scheduler（/workspace，PID 由 background terminal 管理）持续运行。全自动方式：scheduler 推送前 auth.ensureLogin 检测失效→推送二维码到微信→用户扫码→自动写库刷新。手动方式：打开 localhost:4500 扫码，但 qrlogin 扫码后 token 只存内存不自动写库，需再调 tRPC account.edit（POST /trpc/account.edit?batch=1 body {"0":{"id":"431803268","data":{"token":"<新token>","status":1}}}）回写数据库。
  - 公众号 token 是微信读书 Bearer token，无固定有效期会过期；本地库 token 更新与 GitHub Secret 是"复制"关系不同步，本机自动续期换新 token 后必须跑 sync-secret.sh 云端才生效。
  - 检测频率：云端 GitHub Actions 无独立高频检测，仅在每天 cron(7:00) 运行一次时调用 checkPlatformToken（即 24h 一次）；本地 scheduler 登录检测频率由 config.json 的 loginCheckIntervalHours 控制（已设为 6，默认 6），用独立状态文件 data/lastlogincheck.json 记录上次检测时间，检测成功才刷新时间戳、失败下轮重试；推送时（24h 周期）main() 内仍强制自检确保 token 有效。降低频率是为减少对微信读书的探测以降低风控暴露面。

[Environment Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while explaining the runtime topology to a locally cloned copy of this repository
- Category: Environment Configuration
- Instructions:
  - 本仓库存在三个运行位置，路径含义随环境不同：devbox（云端沙箱开发环境，实际运行地，项目根为 /workspace，wewe-rss 服务在 /tmp/opencode/wewe-rss、扫码服务在 /tmp/opencode/qrlogin/server.js）；GitHub Actions（云端定时任务，每次运行从仓库 clone 到 /home/runner/work/wechat-ai-push/wechat-ai-push）；本机（用户 Windows 电脑，克隆位置如 C:\Users\18858\MonkeyCode\wechat-ai-push）。用户在本机提问时，"本地 wewe-rss/scheduler/token"指的是 devbox 环境中的进程，本机克隆只有代码没有运行中的服务，路径须对应到 devbox 的解释不能照抄本机。
  - devbox 是一个云端 Linux 开发环境（opencode/MonkeyCode 平台），运行在服务器上而非用户电脑；用户通过浏览器/IDE 访问，本机无直接文件系统通路，文件需经 git 同步或用户手动上传/下载。
  - 微信读书 token、wewe-rss 数据库、pushplus token 均只在 devbox 的 /workspace 与 /tmp/opencode/wewe-rss 下，不入 git；本机 clone 后这些敏感文件不存在，需用户询问 devbox 会话或按 config.example.json 重建。
  - 用户问"devbox 在哪里"时，正确回答：devbox 是承载本项目的云端 Linux 开发环境，运行着我们正在维护的 wewe-rss(4000)、qrlogin(4500)、scheduler 服务与微信读书 token；代码已通过 git 同步到 GitHub 仓库，本机克隆仅用于阅读代码和了解维护流程，实际运行与 token 维护需在 devbox 会话内进行。

[Project Knowledge Summary]
- Date: 2026-08-19
- Context: Discovered by Agent while adding phone-only token renewal (auto-sync Secret + auto re-push) to the push service
- Category: Operations & Deployment
- Instructions:
  - 手机端扫码续期闭环（纯手机操作）：微信读书 token 失效时用户只需扫 scheduler 推送的二维码，续期成功后依次自动完成 写回 wewe-rss 库 → gh secret set WEWE_TOKEN 同步 GitHub Secret → dispatch 云端 workflow（ai-news.yml）立即重推完整日报，无需再手动跑 sync-secret.sh 或在电脑前操作。
  - 实现：src/syncSecret.js 新增 syncAfterRenew(token)，在 src/auth.js ensureLogin 扫码成功（renewed=true）分支调用；凭据读 config.json 的 githubToken（或环境变量 GH_TOKEN），用 gh CLI 的 stdin 方式设置 Secret（token 不落盘、不进命令行），成功后 POST /repos/{repo}/actions/workflows/ai-news.yml/dispatches 触发重推（需要 PAT 有 workflow scope）。githubRepo/githubRef 可在 config.json 覆盖，默认 188586098-eng/wechat-ai-push / main。
  - 已配置 GitHub Secrets 实测为 3 个：PUSHPLUS_TOKEN、USER_LLM_API_KEY、WEWE_TOKEN；用户 PAT（ghp_ 开头）实测含 repo+workflow scope，满足自动同步与触发 workflow。
  - 注意：验证 gh secret set 时曾用占位值覆盖 WEWE_TOKEN（原值本已失效），需在 devbox 重新运行 sync-secret.sh 或完成一次扫码续期恢复。
  - 2026-08-19 已恢复：重新扫码续期成功，新 token 已写回本地库（平台验证 HTTP 200），并运行 sync-secret.sh 同步到 GitHub Secret，两端一致。devbox config.json 未配置 githubToken，因此 syncSecret.js 的自动同步未生效，当前 token 同步靠手动运行 sync-secret.sh（带 GH_TOKEN 环境变量）。若需扫码后全自动同步，在 devbox config.json 增加 "githubToken": "<PAT>"（可选）。scheduler 扫码成功后会自动抓取并推送日报（本次实测抓 126 篇推 10 篇，pushplus code:200）。
