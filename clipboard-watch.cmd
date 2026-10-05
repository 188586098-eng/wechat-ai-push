@echo off
rem 剪贴板归档：微信里对文章执行「⋯ → 复制链接」，本机自动存成 Markdown + 本地图片
cd /d %~dp0
if not exist data mkdir data
node src\wechat-clipboard.js
