# 归档结果核对：确认一篇归档文章的正文和图片都真的落到了本地。
#
# 用法（不填任何参数，就自动核对「最近归档的那一篇」）：
#   check-archive.cmd                双击运行，或核对最新一篇
#   check-archive.cmd 2026-10-04     只核对文件名里含这个关键字的文章
#   check-archive.cmd 盘点本周       关键字也可以是标题里的词
#
# 核对四件事：元数据、正文首尾、图片是否真的下载到本地、幂等记录。

param(
    [Parameter(Position = 0)]
    [string]$Keyword = ''
)

$ErrorActionPreference = 'Stop'

# 本脚本放在 src\ 下，项目根目录就是它的上一级
$root = Split-Path -Parent $PSScriptRoot
$archiveRoot = Join-Path $root 'data\wechat-archive'

if (-not (Test-Path $archiveRoot)) {
    Write-Host "找不到归档目录：$archiveRoot" -ForegroundColor Yellow
    exit 1
}

# 把所有已归档文章的 Markdown 收集起来
$all = @(
    Get-ChildItem $archiveRoot -Recurse -File -Filter '*.md' |
        Where-Object { $_.Directory.Name -ne 'images' }
)

if ($all.Count -eq 0) {
    Write-Host '归档目录里还没有任何文章。' -ForegroundColor Yellow
    exit 1
}

if ($Keyword) {
    $cand = @($all | Where-Object { $_.Name -like "*$Keyword*" })
    if ($cand.Count -eq 0) {
        Write-Host "没有找到文件名包含「$Keyword」的文章。" -ForegroundColor Yellow
        exit 1
    }
    $target = $cand | Sort-Object LastWriteTime -Descending | Select-Object -First 1
} else {
    $target = $all | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$account = $target.Directory.Name
$lines = @(Get-Content $target.FullName -Encoding UTF8)

Write-Host ''
Write-Host "核对文章：$account\$($target.Name)" -ForegroundColor Cyan
Write-Host "文件大小：$([math]::Round($target.Length / 1KB, 1)) KB，共 $($lines.Count) 行"
Write-Host ''

# ---------- 1/4 元数据 ----------
Write-Host '【1/4】元数据' -ForegroundColor Green
$head = ($lines | Select-Object -First 12) -join "`n"
foreach ($key in 'title', 'author', 'account', 'publish_time', 'source_url') {
    $m = [regex]::Match($head, "(?m)^${key}:\s*""(.*)""")
    if ($m.Success) {
        Write-Host "    $key = $($m.Groups[1].Value)"
    } else {
        Write-Host "    $key = （缺失）" -ForegroundColor Red
    }
}
Write-Host ''

# ---------- 2/4 正文 ----------
Write-Host '【2/4】正文' -ForegroundColor Green
# 正文字数：去掉 Front Matter、标题、引用块和图片链接后的粗略统计
$bodyLines = @($lines | Where-Object { $_ -notmatch '^---\s*$' -and $_ -notmatch '^#\s' -and $_ -notmatch '^>\s' })
$bodyChars = ($bodyLines -join '').Length
Write-Host "    正文约 $bodyChars 字"
Write-Host '    结尾 3 行：'
foreach ($l in ($lines | Select-Object -Last 3)) {
    if ($l.Trim()) { Write-Host "      $($l.Trim())" }
}

# 风控/异常页特征：抓到这些说明拿到的不是正文
$riskWords = @('环境异常', '请在微信客户端打开', '去验证', '参数错误', '该内容已被发布者删除', '此内容因违规无法查看', '访问过于频繁')
$hit = @($riskWords | Where-Object { $lines -match [regex]::Escape($_) })
if ($hit.Count -gt 0) {
    Write-Host "    ！正文里出现异常页特征词：$($hit -join '、')" -ForegroundColor Red
} else {
    Write-Host '    未发现异常页特征 ✅' -ForegroundColor Green
}
Write-Host ''

# ---------- 3/4 图片 ----------
Write-Host '【3/4】图片' -ForegroundColor Green
$missing = @()
$broken = @()
$refs = @(
    (Select-String -Path $target.FullName -Pattern '!\[[^\]]*\]\((images/[^)]+)\)' -Encoding UTF8).Matches |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique
)

if ($refs.Count -eq 0) {
    Write-Host '    这篇文章没有引用图片（或用了 --no-images）。' -ForegroundColor DarkGray
} else {
    $tally = @{}
    $totalBytes = 0

    foreach ($r in $refs) {
        $p = Join-Path $target.DirectoryName ($r -replace '/', '\')
        if (-not (Test-Path $p)) { $missing += $r; continue }

        $fi = Get-Item $p
        $totalBytes += $fi.Length

        # 用文件头魔数判断真实格式，不看扩展名
        $b = [System.IO.File]::ReadAllBytes($p)
        $kind = ''
        if ($b.Length -gt 12) {
            if ($b[0] -eq 0x89 -and $b[1] -eq 0x50 -and $b[2] -eq 0x4E -and $b[3] -eq 0x47) { $kind = 'PNG' }
            elseif ($b[0] -eq 0xFF -and $b[1] -eq 0xD8) { $kind = 'JPEG' }
            elseif ($b[0] -eq 0x47 -and $b[1] -eq 0x49 -and $b[2] -eq 0x46) { $kind = 'GIF' }
            elseif ($b[0] -eq 0x52 -and $b[1] -eq 0x49 -and $b[2] -eq 0x46 -and $b[8] -eq 0x57 -and $b[9] -eq 0x45 -and $b[10] -eq 0x42 -and $b[11] -eq 0x50) { $kind = 'WEBP' }
        }
        if (-not $kind) { $broken += $r; continue }

        if ($tally.ContainsKey($kind)) { $tally[$kind]++ } else { $tally[$kind] = 1 }
    }

    Write-Host "    Markdown 引用 $($refs.Count) 张，共 $([math]::Round($totalBytes / 1KB, 1)) KB"
    foreach ($k in ($tally.Keys | Sort-Object)) {
        Write-Host "      $k : $($tally[$k]) 张"
    }

    if ($missing.Count -gt 0) {
        Write-Host "    ！$($missing.Count) 张文件不存在：" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
    }
    if ($broken.Count -gt 0) {
        Write-Host "    ！$($broken.Count) 张文件头损坏：" -ForegroundColor Red
        $broken | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
    }
    if ($missing.Count -eq 0 -and $broken.Count -eq 0) {
        Write-Host '    全部落地且格式合法 ✅' -ForegroundColor Green
    }
}
Write-Host ''

# ---------- 4/4 幂等记录 ----------
Write-Host '【4/4】幂等记录' -ForegroundColor Green
$statePath = Join-Path $archiveRoot '.archive-state.json'
if (Test-Path $statePath) {
    $state = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $urls = @($state.PSObject.Properties.Name)

    $src = [regex]::Match($head, '(?m)^source_url:\s*"(.*)"').Groups[1].Value
    Write-Host "    状态文件共 $($urls.Count) 条"
    if ($src -and ($urls -contains $src)) {
        Write-Host "    本文已登记（重复归档会自动跳过）✅" -ForegroundColor Green
    } else {
        Write-Host '    ！本文未登记，下次可能重复归档' -ForegroundColor Red
    }
} else {
    Write-Host '    ！找不到 .archive-state.json' -ForegroundColor Red
}

Write-Host ''
$verdict = ($hit.Count -eq 0) -and ($missing.Count -eq 0) -and ($broken.Count -eq 0)
if ($verdict) {
    Write-Host '核对结果：一切正常 ✅' -ForegroundColor Green
} else {
    Write-Host '核对结果：发现问题，见上面标红的部分。' -ForegroundColor Yellow
}
Write-Host ''
