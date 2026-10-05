@echo off
rem Check an archived article: metadata, body, local images, dedup record.
rem
rem Usage:
rem   double-click this file        -> check the most recently archived article
rem   check-archive.cmd <keyword>   -> check the article whose filename contains it
rem                                    e.g.  check-archive.cmd 2026-10-04
rem
rem NOTE: keep this file pure ASCII. cmd.exe does not reliably re-read a batch
rem file after "chcp", so any non-ASCII byte here gets mis-parsed as a command.
rem All Chinese output is produced by src\verify-archive.ps1 instead.

cd /d %~dp0
chcp 65001 >nul

set PS=powershell
where pwsh >nul 2>nul
if %errorlevel%==0 set PS=pwsh

"%PS%" -NoProfile -ExecutionPolicy Bypass -File src\verify-archive.ps1 %*
echo.
pause
