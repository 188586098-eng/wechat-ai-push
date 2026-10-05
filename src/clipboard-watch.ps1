# 监听剪贴板变化，供 wechat-clipboard.js 使用。
#
# 为什么用 GetClipboardSequenceNumber：它是纯计数器的系统调用，剪贴板每变化一次就 +1。
# 只比较这个数字，就避免了每次都去真读剪贴板内容（读内容开销大得多）。
#
# 为什么把等待循环下沉到 C#：这个循环最初是用 PowerShell 写的（while + Start-Sleep +
# 每次调用 P/Invoke），实测空闲期会持续吃掉约 14% 的单核 —— PowerShell 解释器每跑完
# 一轮迭代本身就要几十毫秒 CPU，而轮询每秒要跑 2.5 轮。改成编译后的 .NET 循环后，
# PowerShell 只在剪贴板真的变化时才被唤醒，空闲 CPU 降到 0。
#
# 输出协议：每次检测到变化，向 stdout 输出一行 base64（UTF-8 编码的剪贴板文本）。
# 用 base64 是因为剪贴板内容可能含换行、中文和各种标点，直接按行输出无法可靠分帧。
Add-Type -Namespace WxClip -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();

// 阻塞等待剪贴板变化：内部按 500ms 轮询，一旦变化立刻返回新的序列号；
// 超过 timeoutMs 仍无变化则原样返回传入值，交由调用方决定是继续等还是做别的事。
// 500ms 是实测出来的平衡点：250ms 时空闲 CPU 约 2.3%，500ms 后降到约 0.6%，
// 而 0.5 秒的识别延迟对「复制链接后自动归档」这个场景完全无感。
public static uint WaitForChange(uint last, int timeoutMs)
{
    int deadline = System.Environment.TickCount + timeoutMs;
    while (System.Environment.TickCount < deadline)
    {
        uint now = GetClipboardSequenceNumber();
        if (now != last) return now;
        System.Threading.Thread.Sleep(500);
    }
    return last;
}
'@

$last = [WxClip.Native]::GetClipboardSequenceNumber()

while ($true) {
    # 每轮最多阻塞一分钟再回头检查一次，避免 TickCount 回绕带来的边界问题
    $seq = [WxClip.Native]::WaitForChange($last, 60000)
    if ($seq -eq $last) { continue }
    $last = $seq

    # 剪贴板可能被别的程序锁住，或内容不是文本（比如复制了文件），读失败就跳过
    try {
        $text = Get-Clipboard -Raw -ErrorAction Stop
    } catch {
        continue
    }
    if ([string]::IsNullOrWhiteSpace($text)) { continue }

    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
    [Console]::Out.WriteLine($b64)
    [Console]::Out.Flush()
}
