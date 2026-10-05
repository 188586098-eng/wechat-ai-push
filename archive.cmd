@echo off
rem Archive WeChat articles (short links) as Markdown + local images.
rem
rem Usage:
rem   archive.cmd <url> [<url> ...]     archive these links
rem   archive.cmd --in data\links.txt   archive every link listed in that file
rem   double-click with no argument     show the built-in help
rem
rem NOTE: keep this file pure ASCII. cmd.exe mis-parses non-ASCII bytes in a
rem batch file (even after "chcp"), which corrupts the if-block below. All
rem Chinese output comes from node: src\wechat-archive\index.js

cd /d %~dp0
chcp 65001 >nul
if not exist data mkdir data

if "%~1"=="" (
    node src\wechat-archive\index.js --help
    echo.
    pause
    exit /b
)

node src\wechat-archive\index.js %*
echo.
pause
