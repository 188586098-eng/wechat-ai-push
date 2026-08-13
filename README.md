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

## 注意事项

- 抓取频率保持低频（单次请求每源一页），避免触发站点风控
- 若某数据源改版导致解析失效，运行日志会显示「失败」，按需调整 `src/sources.js`
- 推送选文按**源轮询**取篇（每源最多 `perSourceLimit` 篇），保证各源都有机会入选，总数不超过 `pushLimitPerRun`

## 依赖的 wewe-rss 服务

机器之心、虎嗅等公众号源依赖本地运行的 wewe-rss（http://localhost:4000）：
- 微信读书账号扫码登录后订阅公众号，`/feeds/{mp_id}.rss` 输出 RSS 2.0
- wewe-rss 为自建部署（/tmp/opencode/wewe-rss，SQLite 模式，AUTH_CODE=wewe-admin-2026）
- 若该服务未运行，对应源会抓取失败并在日志提示，其余官网源不受影响
