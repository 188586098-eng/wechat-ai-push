# AI 资讯日报 GitHub Actions 部署指南

本项目通过 GitHub Actions 定时任务，每天北京时间 7:00 自动抓取 AI 资讯、生成 LLM 摘要，并通过 pushplus 推送到你的微信。运行在 GitHub 云端，不依赖本地电脑或 devbox。

## 目录结构

```
├── .github/workflows/ai-news.yml   # 定时任务定义
├── gh-actions/
│   ├── index.js                    # 主脚本：健康检测 → 抓取 → 选文 → LLM 摘要 → 推送
│   ├── health.js                   # 公众号 token 健康检测（失效自动降级）
│   ├── fetch.js                    # HTTP 抓取（带重试）
│   ├── sources.js                  # 各源解析器
│   ├── llm.js                      # DeepSeek 摘要生成
│   ├── push.js                     # pushplus HTML 组装
│   └── wechat.js                   # 公众号平台 API 源
├── sync-secret.sh                  # 本机一键同步 WEWE_TOKEN 到 GitHub Secret
└── .gitignore                      # 忽略 token 配置与输出
```

## 数据源

### 官网源（直接抓取）

| 源 | URL | 类型 |
|----|-----|------|
| 量子位 | https://www.qbitai.com/ | 官网首页 |
| 智东西 | https://www.zhidx.com/ | 官网首页 |
| 新智元 | https://aiera.com.cn/ | 官网首页 |
| 36氪 | https://gateway.36kr.com/api/... | 热榜 API |
| InfoQ | https://www.infoq.cn/ | 官网热榜 |
| 刘润 | https://m.163.com/news/sub/... | 网易号 |

### 公众号源（微信读书平台 API）

通过微信读书平台接口（`weread.111965.xyz/api/v2/platform/mps/{mpId}/articles`）获取，需要微信读书登录 token：

| 公众号 | mpId |
|--------|------|
| 机器之心 | MP_WXS_3073282833 |
| 虎嗅 | MP_WXS_1432156401 |
| 数字生命卡兹克 | MP_WXS_3223096120 |
| 极客公园 | MP_WXS_1304308441 |
| 腾讯技术工程 | MP_WXS_2398602260 |
| 逛逛GitHub | MP_WXS_3516884134 |
| Datawhale | MP_WXS_3226363426 |
| 腾讯云开发者 | MP_WXS_3264589119 |

> 说明：GitHub Actions 运行在隔离环境，无法访问本地 wewe-rss 服务，因此直接调用微信读书平台 API 获取公众号文章，无需部署 wewe-rss。

### 登录失效自动处理

每次运行先做 token 健康检测（`health.js`）：

- **token 有效**：正常抓取公众号 + 官网源，推送完整日报
- **token 失效（401）**：自动降级为纯官网源日报（日报不断更），同时 pushplus 单独推送一条「微信读书登录已失效」提醒，指导你完成续期

## 部署步骤

### 1. 创建私有 GitHub 仓库

1. 打开 https://github.com/new
2. Repository name 填 `ai-news-daily`
3. 选择 **Private**（必须，防止 token 泄露）
4. 不勾选 README/.gitignore 初始化，保持空仓库，点 Create repository

### 2. 配置 Secrets

仓库页面 → Settings → Secrets and variables → Actions → New repository secret，依次添加：

| Name | Value | 必填 |
|------|-------|------|
| `PUSHPLUS_TOKEN` | 你的 pushplus token（https://www.pushplus.plus/ 一对一推送页面复制） | 是 |
| `USER_LLM_API_KEY` | 你的 DeepSeek key（https://platform.deepseek.com 申请，格式 `sk-...`） | 否（缺省则无摘要） |
| `USER_LLM_BASE_URL` | 可选，默认 `https://api.deepseek.com/v1`，换其他服务商才填 | 否 |
| `USER_LLM_MODEL` | 可选，默认 `deepseek-chat` | 否 |
| `WEWE_TOKEN` | 微信读书平台 Bearer token（GitHub 无法生成，需从本地 wewe-rss 数据库 accounts 表复制，见下） | 是（获取公众号文章必需） |
| `WEWE_XID` | 微信读书账号 id，默认 `431803268` | 否 |
| `PLATFORM_URL` | 可选，默认 `https://weread.111965.xyz` | 否 |

### 获取 WEWE_TOKEN / 失效续期

收到「微信读书登录已失效」提醒时，本机执行：

1. 打开 `http://localhost:4500` 用微信读书 App 扫码（新 token 自动写入本地 wewe-rss 数据库）
2. 运行一键同步脚本（把新 token 更新到 GitHub Secret）：

```bash
cd /workspace && ./sync-secret.sh
```

3. 仓库 Actions 页手动 Run workflow，公众号源即恢复。

脚本依赖 `gh` CLI（已登录或设置 `GH_TOKEN` 环境变量），从本地库读取 token 后直接更新 `WEWE_TOKEN` Secret，token 不会写入任何文件。

### 3. 上传代码

在你自己电脑的仓库目录执行：

```bash
git init
git add .
git commit -m "feat: AI 资讯日报定时推送"
git branch -M main
git remote add origin https://github.com/<你的用户名>/ai-news-daily.git
git push -u origin main
```

注意：`gh-actions/data/`（去重记录）和 `gh-actions/output/`（日报）已被 .gitignore 忽略，token 全部走 Secrets，不会提交。

### 4. 手动触发测试

仓库页面 → Actions → 左侧 ai-news-daily → Run workflow 按钮 → 立即运行。

### 5. 验证

- 运行约 1-3 分钟后，Actions 日志显示所有步骤绿色
- 微信收到推送即成功（LLM 摘要 + 各源精选）
- 运行详情页底部 Artifacts 有 `ai-news-daily-report`，可下载当日日报 md 文件（含完整链接），保留 30 天

## 运行说明

- **自动执行**：每天早上 7:00（北京时间，cron 为 UTC 23:00），GitHub 定时任务最长延迟约 15 分钟属正常
- **重跑某天**：进 Actions 手动 Run workflow 即可
- **查看原文**：下载 artifact 里的 md 文件
- **去重**：脚本将已推送文章 URL 存入 `gh-actions/data/sent.json`，通过 actions/cache 跨运行保留，避免重复推送
