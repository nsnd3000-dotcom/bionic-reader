# OCR 桥接：给扫描件补文字层

## 先说清楚：现在**不是必须**跑 OCR 了

阅读器已经改成**原版式阅读**（像 SumatraPDF），所以：

| 你想做什么 | 需要 OCR 吗 |
|---|---|
| 扫描件**能看** | ❌ **不需要** —— 直接打开，看的就是原图 |
| 扫描件**能高亮文字块** | ✅ 需要 —— 没文字层就没有可定位的高亮目标 |
| 扫描件**能选中/搜索文字** | ✅ 需要 |

所以 OCR 从"必须"降级成了"可选增强"。只为读的话，直接拖进去就行。

## 为什么高亮需要它

高亮靠 pdf.js 的 `TextLayer` —— 它要在 canvas 之上生成一层与原文位置
对齐的透明文字块，才有东西可以加底色。

扫描件 PDF（每页一张拍照/影印图）**根本没有文字层**，pdf.js 抽不到任何
文字块，也就无从定位。这时候阅读器**不会报错**，照常显示原图，
只是高亮开关点开也不会有任何变化（页面上没有可高亮的对象）。

想高亮，就用本目录的脚本先补一层文字。

> 这也是为什么"仿生加粗"在 PDF 上做不到：页面文字已经栅格化进像素了。
> 详见 [pdf/README-pdf.md](../pdf/README-pdf.md) 的"高亮只能做整块"。

## 快速开始

```powershell
# 0) 装依赖（只装一次）
python -m pip install pymupdf rapidocr-onnxruntime

# 1) 把扫描件 OCR 成带文字层的 PDF
python ocr/pdf_ocr.py 我的书.pdf -o 我的书.ocr.pdf --dpi 300 --workers 4

# 2) 把 我的书.ocr.pdf 拖进阅读器，然后勾选"文字高亮"
```

实测：**325 页中文扫描书，250 dpi / 6 线程，约 32 分钟**，产出 3375 段文字层。

## 参数怎么选

| 参数 | 默认 | 说明 |
|---|---|---|
| `--dpi` | 300 | 渲染精度。中文扫描稿 250–300 足够；字特别小就上 400，代价是耗时线性增长 |
| `--workers` | 4 | 并行线程数。CPU 核数左右比较合适；太多会互相抢 |
| `--pages` | 全部 | 只处理部分页，如 `1-20` 或 `1,5,9`。**建议先用 3~5 页试效果再全量跑** |

## 产物是什么

输出的 PDF **保留原来的页面图像**（所以看上去和原书一模一样），
只是每页多了一层 **`render_mode=3` 的不可见文字**。

这样做的理由：

1. 阅读器按原版式显示，原图不变 —— 文字层只用来定位高亮
2. 生成的 PDF 用**任何**阅读器都能选中/搜索文字，不局限本项目
3. OCR 有错字时可以直接看原图核对

## 实现中踩过的坑（改代码前先读）

### 1. Windows 自带 OCR 在这台机器上用不了

`Windows.Media.Ocr` 是零依赖的好选择，本机也确实装了 `zh-Hans-CN` 识别器。
但它跑在 **AppContainer** 里，而普通 `powershell.exe` **没有包身份**
（no package identity），于是：

```
StorageFile.GetFileFromPathAsync     → 拒绝访问
FileRandomAccessStream.OpenAsync     → 拒绝访问
ApplicationData.Current.LocalFolder  → no package identity (0x80073D54)
StorageApplicationPermissions        → 拒绝访问
```

把图片拷进 `%TEMP%` 也没用 —— 拦截发生在**文件代理层**，与路径无关。

绕过办法是"自己解码像素 → 直接构造 `SoftwareBitmap`"，但这条路上
PowerShell 的 WinRT 互操作又到处是坑：

- `[Windows.Storage.Streams.DataWriter]::new()` 返回 **null**
- `DataWriter.WriteBytes(byte[])` 即使能调，`IBuffer.Length` 也是 **0**
- `WindowsRuntimeBufferExtensions.AsBuffer` 返回 **null**
- `Add-Type` 里写 `Windows.Storage.Streams.IBuffer` 会因缺程序集编译失败
- 改用 `csc.exe` + `C:\Windows\System32\WinMetadata\*.winmd` 手动编译，
  又因为本机**没有 `Windows.winmd` 主元数据文件**，类型标识无法统一而失败

**结论：放弃 Windows OCR，改用 RapidOCR。** 上面这段弯路不必重走。

### 2. `import fitz` 可能解析到一个空模块

pymupdf 1.24+ 的正式入口是 `import pymupdf`。某些安装形态下
`import fitz` 会拿到一个**空的命名空间包**，表现为：

```
AttributeError: module 'fitz' has no attribute 'open'
```

代码里只用 `import pymupdf`。

### 3. 不能用 `multiprocessing`

本沙箱禁止创建命名管道，`ProcessPoolExecutor` 直接 `PermissionError`。
改用 `ThreadPoolExecutor` —— onnxruntime 推理会释放 GIL，实际并行度够用。

### 4. 字号必须逐页统一，不能按段算

OCR 框的高度随"这一段有几行"而变（单行框 vs 三行框差很多）。
早期版本按每段框高算字号，结果同一页散成
`13.5/15.0/15.2/15.4/16.9/17.2` 一大串。

这条在阅读器改成原版式之后**仍然要守**：文字层虽不再用于重排，
但字号乱跳会让 pdf.js 的 `TextLayer` 生成尺寸不一的文字块，
高亮色带就会高低不齐、粗细难看。

现在取页内行高的**中位数**作为全页字号（中位数对"标题特别大/页脚特别小"
这类离群值不敏感）。

### 5. 页码与正文要分开

页眉页脚（书名、页码）如果与正文合并成一个文字块，高亮色带会把
页眉和正文框在一起，很难看。

OCR 侧靠 `_merge_lines_to_paragraphs` 的间距/缩进判据尽量少合并
（行距突然变大、行首缩进、上一行以句末标点结尾 → 断段）。

> 早期版本还在阅读器侧做"跨页重复行识别"来剔除页眉页脚。
> 改成原版式阅读之后**不需要了** —— 显示的是原图，页眉页脚本来就该在，
> 文字层只要如实标注它们的位置即可。

## 目录结构

```
ocr/
├── README-ocr.md        本文件
├── requirements-ocr.txt 依赖清单
├── pdf_ocr.py           主脚本：扫描件 PDF → 带文字层 PDF
├── rapidocr.py          RapidOCR 封装：图片 → 带坐标的文本框
├── render_pdf.py        把 PDF 页面渲染成 PNG（调试用）
└── winocr.py            Windows OCR 封装（**本机不可用**，保留供参考/其它机器）
```

## 已知限制

- **OCR 必然有错字**。实测这本中文书的识别质量不错，但"大概"→"天概"、
  "问题"→"间题"这类错误仍然会出现。这是扫描件的固有限制，不是 bug。
- 表格、公式、多栏排版的重建质量较差 —— 这类内容本来就是 OCR 的弱项。
- 竖排中文、特殊字体、低质量扫描的识别率会明显下降。
- 目前不做版面分析（分栏检测），双栏书会按"从左到右、从上到下"串行读取。
