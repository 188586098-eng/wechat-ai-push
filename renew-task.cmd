@echo off
rem 每日晚间续期任务：确保 wewe-rss 运行 -> 执行续期/同步/触发云端
cd /d C:\Users\18858\MonkeyCode\wewe-rss
if not exist server.log echo. > server.log
node ensure-running.js
cd /d C:\Users\18858\MonkeyCode\wechat-ai-push
if not exist data mkdir data
node src\renewEvening.js >> data\renew.log 2>&1
