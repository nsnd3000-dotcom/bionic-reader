@echo off
rem ============================================================
rem  Bionic Reader 一键启动
rem  双击本文件即可在浏览器中打开阅读器。
rem
rem  为什么要起本地服务而不是直接双击 index.html：
rem  1) file:// 下浏览器把 origin 视为 opaque，localStorage 会抛
rem     SecurityError，设置与阅读进度无法保存；
rem  2) 本地服务下一切功能完整，且 JSZip 只需加载一次。
rem ============================================================
setlocal
cd /d "%~dp0"

set PORT=8080

echo.
echo   Bionic Reader
echo   ----------------------------------------
echo   正在启动本地服务 http://localhost:%PORT%/
echo   浏览器会自动打开。关闭本窗口即可停止服务。
echo   ----------------------------------------
echo.

rem 若端口被占用，自动换一个
:findport
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo   端口 %PORT% 已被占用，尝试 %PORT_ALT% ...
  set /a PORT=%PORT%+1
  if %PORT% gtr 8100 (
    echo   找不到可用端口，请手动关闭占用程序。
    pause
    exit /b 1
  )
  goto findport
)

rem 延迟 1 秒后打开浏览器（等服务起来）
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:%PORT%/"

rem 优先用 py 启动器，其次 python
rem 自建 no-cache 服务：python -m http.server 不发缓存控制头，
rem 浏览器会拿旧 index.html，改完代码刷新看不到变化。
where py >nul 2>&1
if %errorlevel%==0 (
  set PY=py
) else (
  set PY=python
)
%PY% "%~dp0_serve.py" %PORT%

echo.
echo   服务已停止。
pause
