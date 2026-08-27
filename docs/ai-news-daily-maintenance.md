# ai-news-daily 云端任务维护记录

本文档备份 `188586098-eng/ai-news-daily` 云端定时任务的维护记录，供后期排查参考。

## 项目概况

- 仓库：https://github.com/188586098-eng/ai-news-daily（私有）
- 技术栈：Python 标准库（`fetch_news.py`），零第三方依赖
- 定时任务：GitHub Actions `.github/workflows/ai-news.yml`
- 数据源：Google News 主题搜索（中英文 6 组）+ 固定 RSS/Atom 源（InfoQ、爱范儿、OpenAI、Google AI、DeepMind、TechCrunch）
- 推送：PushPlus → 微信

## 维护记录

### 2026-08-27 推送延迟排查（GitHub 平台故障）+ 失败通知上线

- **现象**：8/27 推送于北京时间 12:09 送达（预期 07:00）；8/26 的定时槽位（UTC 23:00）无任何运行记录
- **排查**：cron 配置正确（`0 23 * * *`）；8/22–8/25 连续 4 天准时触发（23:12–23:17Z）；8/27 运行的 `created_at` 与 `run_started_at` 均为 04:09Z，说明是 GitHub 调度器晚创建任务，而非执行排队等待
- **根因**：GitHub 官方状态页记录 8/26 两起 Actions 故障——15:02–17:40 UTC「Actions jobs failed to start」，22:56 UTC 至次日 00:26 UTC「约 20% 运行启动延迟」。定时槽位 23:00Z 恰处第二个故障窗口内，平台恢复后积压任务于 04:09Z 补跑
- **改进**：workflow 新增「失败时推送提醒」步骤（`if: failure()`），job 失败时经 PushPlus 发送含日志链接的提醒
- **验证**：本地 YAML + 内嵌 Python 语法校验通过；推送后手动触发 run #21 成功
- 对应 commit：`af3d27e`（workflow）、`6adf88b`（README）
- **结论**：GitHub schedule 准时性受平台负载影响无法 100% 保证；偶发延迟≠失败，任务最终会补跑

### 2026-08-22 定时任务时间调整

- 推送时间由北京时间 08:00 调整为 **07:00**（cron `0 23 * * *`，UTC 23:00）
- 修改文件：`.github/workflows/ai-news.yml`
- 对应 commit：`bbbeb6b`

### 2026-08-21 推送偶发失败修复

- **现象**：2026-08-20 定时运行抓取正常（129 条），推送微信时报 `[Errno 104] Connection reset by peer`（pushplus 接口连接被重置），进程 exit code 1，当天微信未收到日报
- **原因**：pushplus 服务端偶发网络异常，非代码或配置故障（次日定时运行自动恢复成功）
- **修复**：`fetch_news.py` 新增 `http_post_with_retry()`，推送遇网络层异常（连接重置/超时/DNS 等）自动重试 3 次（间隔 5s→10s→20s 递增）；HTTP 4xx/5xx 等服务端明确响应不重试，直接抛错
- **覆盖渠道**：Server酱、PushPlus
- **验证**：本地 3 个单元测试通过；补丁上线后云端手动触发运行成功
- 对应 commit：`1a0f844`

## 排查经验

- GitHub Actions 运行日志下载接口返回的是 **zip 压缩包**（`.log` 文件实为 zip），需解压后查看各 step 文本（新版接口文件名为 `0_<job-name>.txt`）
- **判断调度器延迟 vs 执行排队**：对比运行的 `created_at` 与 `run_started_at`——两者接近说明调度器本身晚触发（平台侧问题）；`created_at` 早而 `started_at` 晚说明是排队等待
- GitHub 状态页 API 可查故障：`https://www.githubstatus.com/api/v2/incidents.json`（无需认证）
- 定时任务 cron 为 UTC 时区，北京时间 = UTC + 8 小时
- 本地维护时凭据从 `git credential fill` 获取（Git Credential Manager 已存 token），可访问私有仓库 Actions API
- 云端 workflow 手动触发：`POST /repos/{repo}/actions/workflows/ai-news.yml/dispatches`，body `{"ref":"main"}`；本地调 GitHub API 遇 SSL/网络抖动应加重试
- schedule 触发与 workflow_dispatch 触发在 Actions 运行列表中通过 `event` 字段区分

## 当前状态（2026-08-27 确认）

- 定时推送：每天北京时间 **07:00**
- 重试保护：已上线生效（网络层异常自动重试）
- 失败通知：已上线（job 失败时经 PushPlus 推送提醒，含日志链接）
- 已知边界：GitHub 平台故障可能导致定时延迟或槽位跳过，属平台侧问题，无法在仓库层面根治
