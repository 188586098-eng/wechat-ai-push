# ai-news-daily 云端任务维护记录

本文档备份 `188586098-eng/ai-news-daily` 云端定时任务的维护记录，供后期排查参考。

## 项目概况

- 仓库：https://github.com/188586098-eng/ai-news-daily（私有）
- 技术栈：Python 标准库（`fetch_news.py`），零第三方依赖
- 定时任务：GitHub Actions `.github/workflows/ai-news.yml`
- 数据源：Google News 主题搜索（中英文 6 组）+ 固定 RSS/Atom 源（InfoQ、爱范儿、OpenAI、Google AI、DeepMind、TechCrunch）
- 推送：PushPlus → 微信

## 维护记录

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

- GitHub Actions 运行日志下载接口返回的是 **zip 压缩包**（`.log` 文件实为 zip），需解压后查看各 step 文本
- 定时任务 cron 为 UTC 时区，北京时间 = UTC + 8 小时
- 本地维护时凭据从 `git credential fill` 获取（Git Credential Manager 已存 token），可访问私有仓库 Actions API
- 云端 workflow 手动触发：`POST /repos/{repo}/actions/workflows/ai-news.yml/dispatches`，body `{"ref":"main"}`

## 当前状态（2026-08-22 确认）

- 定时推送：每天北京时间 **07:00**
- 重试保护：已上线生效
- 最近运行：8/21、8/22 定时运行均成功，微信正常收到推送
