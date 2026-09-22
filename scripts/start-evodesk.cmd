@echo off
rem EvoDesk 一键启动(双实例):dev(3000) + 生产(3001)
rem 与 ZCode 会话无关,关掉本窗口后两个服务继续运行;停止方式:任务管理器结束 node 进程,或
rem   powershell "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'next' } | % { Stop-Process -Id $_.ProcessId -Force }"
cd /d "%~dp0.."

rem 信任系统证书库:本机网络存在 TLS 拦截,剪藏抓取 GitHub 等站点需要(Node 22.15+/24)
set NODE_USE_SYSTEM_CA=1

rem 生产实例需要 .next 构建产物;缺失时先构建
if not exist ".next\BUILD_ID" (
  echo [evodesk] 未发现生产构建,先执行 npm run build ...
  call npm run build || (echo [evodesk] 构建失败,已中止 & pause & exit /b 1)
)

start "evodesk-dev(3000)" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
start "evodesk-prod(3001)" cmd /k "set PORT=3001&& npm start"

echo.
echo [evodesk] 已启动:
echo   dev  -^> http://localhost:3000
echo   prod -^> http://localhost:3001
echo (各在新窗口运行,关闭对应窗口即停止该实例)
timeout /t 5 >nul
