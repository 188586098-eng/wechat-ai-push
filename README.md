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

## 羊毛线报实时推送

聚合白菜哦（商品好价）/ 专业线报 / 赚客吧 / 新赚吧 / 线报迷（论坛活动线报）共五类优惠信息，按订阅关键词过滤后推送微信。云端每 30 分钟运行一次，每条仅推送一次。

```bash
npm run wool        # 手动运行（抓取→过滤→去重→推送）
npm run wool:mock   # 模拟数据自检，不联网
```

- 关键词：环境变量 `WOOL_KEYWORDS`（逗号分隔）> `config.json` 的 `wool.keywords` > 内置默认清单；排除词同理（`WOOL_EXCLUDE_KEYWORDS` / `wool.excludeKeywords`）
- 云端任务：`.github/workflows/wool-push.yml` 每 30 分钟运行，去重状态存 `data/wool-seen.json`，通过 actions/cache 跨次运行持久化
- 单个来源抓取失败只记日志，不影响其余来源推送

## 依赖的 wewe-rss 服务

机器之心、虎嗅等公众号源依赖本地运行的 wewe-rss（http://localhost:4000）：
- 微信读书账号扫码登录后订阅公众号，`/feeds/{mp_id}.rss` 输出 RSS 2.0
- wewe-rss 为自建部署（/tmp/opencode/wewe-rss，SQLite 模式，AUTH_CODE=wewe-admin-2026）
- 若该服务未运行，对应源会抓取失败并在日志提示，其余官网源不受影响
