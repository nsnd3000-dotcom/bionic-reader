"""Windows.Media.Ocr 封装：把图片喂给系统 OCR，拿回带坐标的文本行。

为什么用 Windows 自带 OCR：
  - 本机已装 zh-Hans-CN 与 en-US 识别器，**零下载、零额外依赖**
  - 对中文扫描书稿质量足够做「可读的仿生阅读」
  - 不需要 tesseract（本机没装，还要额外下语言包）

★ 关键坑（全部实测过，别重复）：

  1. **WinRT 的文件代理在无包身份（no package identity）的进程里不可用。**
     普通 powershell.exe 没有包身份，所以下面这些一律失败：
        · StorageFile.GetFileFromPathAsync      → 拒绝访问
        · FileRandomAccessStream.OpenAsync      → 拒绝访问
        · ApplicationData.Current.LocalFolder   → no package identity (0x80073D54)
        · StorageApplicationPermissions         → 拒绝访问
     把图片拷进 %TEMP% 也没用：拦截在文件代理层，与路径无关。
     ⇒ 唯一路子是自己解码像素，直接构造 SoftwareBitmap，绕开 WinRT 文件 API。

  2. **PowerShell 的 WinRT 互操作在「构造对象」这一步就不可靠：**
        · `[Windows.Storage.Streams.DataWriter]::new()` 返回 **null**
        · `DataWriter.WriteBytes(byte[])` 即使能调，IBuffer.Length 也是 0
        · `WindowsRuntimeBufferExtensions.AsBuffer` 返回 null
        · `Add-Type` 里写 `Windows.Storage.Streams.IBuffer` 会因缺程序集编译失败
     ⇒ 正解：**在 C# 里完成 IBuffer 的构造**，
        而 C# 侧的 WinRT 类型通过 `dynamic` + 运行时投影解析，
        编译期只引用 BCL（System.Drawing / System.Runtime.WindowsRuntime）。

  3. 像素格式必须与 SoftwareBitmap 声明的一致：
     GDI+ 的 Format32bppArgb 在内存里就是 **BGRA** 顺序，
     对应 `BitmapPixelFormat.Bgra8` + `BitmapAlphaMode.Premultiplied`。
"""

import json
import subprocess
import sys
from pathlib import Path

CS_HELPER = r'''
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class OcrBuf {
    /// 读图 -> BGRA32 像素（GDI+ 的 Format32bppArgb 内存布局即 BGRA）
    public static byte[] LoadPixels(string path, out int w, out int h, out int stride) {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read))
        using (var src = new System.Drawing.Bitmap(fs)) {
            w = src.Width; h = src.Height;
            using (var dst = new System.Drawing.Bitmap(w, h,
                    System.Drawing.Imaging.PixelFormat.Format32bppArgb)) {
                using (var g = System.Drawing.Graphics.FromImage(dst)) {
                    g.DrawImage(src, 0, 0, w, h);
                }
                var rect = new System.Drawing.Rectangle(0, 0, w, h);
                var data = dst.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly,
                                        System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                stride = data.Stride;
                var buf = new byte[stride * h];
                Marshal.Copy(data.Scan0, buf, 0, buf.Length);
                dst.UnlockBits(data);
                return buf;
            }
        }
    }

    /// byte[] -> IBuffer。用 dynamic 在运行时解析 WinRT 投影，编译期不引用 Windows.*
    public static object ToBuffer(byte[] data) {
        dynamic writer = Activator.CreateInstance(
            Type.GetType("Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, " +
                         "ContentType=WindowsRuntime"));
        // WriteBytes 在 dynamic 下按数组走，若仍失败则退化为逐字节
        try {
            writer.WriteBytes(data);
            dynamic b = writer.DetachBuffer();
            uint len = (uint)b.Length;
            if (len == (uint)data.Length) return (object)b;
        } catch { }
        // 退化路径：逐字节
        dynamic w2 = Activator.CreateInstance(
            Type.GetType("Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, " +
                         "ContentType=WindowsRuntime"));
        for (int i = 0; i < data.Length; i++) w2.WriteByte(data[i]);
        return (object)(dynamic)w2.DetachBuffer();
    }
}
'''

PS_TEMPLATE = r'''
$ErrorActionPreference = 'Stop'
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type -TypeDefinition '__CS__' -Language CSharp `
        -ReferencedAssemblies 'System.Drawing','Microsoft.CSharp' | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and
    $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
    $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

$src  = '__IMAGE__'
$lang = '__LANG__'

$w = 0; $h = 0; $stride = 0
$pixels = [OcrBuf]::LoadPixels($src, [ref]$w, [ref]$h, [ref]$stride)
$buffer = [OcrBuf]::ToBuffer($pixels)
[Console]::Error.WriteLine("DBG pixels=$($pixels.Length) ${w}x${h} stride=$stride ibuf=$($buffer.Length)")

$sb = [Windows.Graphics.Imaging.SoftwareBitmap]::CreateCopyFromBuffer(
    $buffer,
    [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
    $w, $h,
    [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)

$engine = $null
try { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($lang)) } catch {}
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($null -eq $engine) { Write-Output '{"error":"no ocr engine"}'; exit 1 }

$result = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])

$lines = @()
foreach ($ln in $result.Lines) {
    $words = @()
    foreach ($wd in $ln.Words) {
        $r = $wd.BoundingRect
        $words += [pscustomobject]@{
            t = $wd.Text
            x = [math]::Round($r.X, 1)
            y = [math]::Round($r.Y, 1)
            w = [math]::Round($r.Width, 1)
            h = [math]::Round($r.Height, 1)
        }
    }
    $lines += [pscustomobject]@{ text = $ln.Text; words = $words }
}
[pscustomobject]@{
    lines = $lines
    lang  = $engine.RecognizerLanguage.LanguageTag
    w     = $w
    h     = $h
} | ConvertTo-Json -Depth 6 -Compress
'''


def ocr_image(image_path, lang='zh-Hans-CN', timeout=900):
    """对单张图片跑 Windows OCR，返回 {'lines': [...], 'lang': str, 'w': int, 'h': int}"""
    ps = (PS_TEMPLATE
          .replace('__CS__', CS_HELPER.replace("'", "''"))
          .replace('__IMAGE__', str(Path(image_path).resolve()))
          .replace('__LANG__', lang))
    r = subprocess.run(
        ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
    )
    out = (r.stdout or '').strip()
    start = out.find('{')
    if start < 0:
        raise RuntimeError(f'OCR 无 JSON 输出 rc={r.returncode} err={(r.stderr or "")[:800]}')
    return json.loads(out[start:])


if __name__ == '__main__':
    p = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else 'zh-Hans-CN'
    res = ocr_image(p, lang)
    lines = res.get('lines', [])
    print(f'# {p}  lang={res.get("lang")}  {res.get("w")}x{res.get("h")}  识别出 {len(lines)} 行')
    for ln in lines[:40]:
        print(f'  [{len(ln["words"]):3d}] {ln["text"]}')
