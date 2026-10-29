@echo off
chcp 65001 >nul
title 任务批量领取助手 - 一键更新

echo ========================================
echo   任务批量领取助手 - 一键更新工具
echo ========================================
echo.

REM 获取脚本所在目录（即插件目录）
set "PLUGIN_DIR=%~dp0"
set "PLUGIN_DIR=%PLUGIN_DIR:~0,-1%"

echo 插件目录: %PLUGIN_DIR%
echo.

REM 查找下载目录中最新的插件zip
set "DOWNLOAD_DIR=%USERPROFILE%\Downloads"
set "LATEST_ZIP="

for /f "delims=" %%i in ('dir /b /o-d "%DOWNLOAD_DIR%\task-claim-helper-*.zip" 2^>nul') do (
    set "LATEST_ZIP=%DOWNLOAD_DIR%\%%i"
    goto :found
)

echo [提示] 未在下载目录找到插件压缩包
echo.
echo 请将下载的 task-claim-helper-vX.X.X.zip 放到以下位置：
echo   %DOWNLOAD_DIR%
echo.
pause
exit /b

:found
echo 找到更新包: %LATEST_ZIP%
echo.

REM 确认更新
set /p CONFIRM="确认更新？(Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo 已取消更新
    pause
    exit /b
)

echo.
echo 正在更新...

REM 创建临时目录
set "TEMP_DIR=%TEMP%\tch_update_%RANDOM%"
mkdir "%TEMP_DIR%"

REM 解压到临时目录
powershell -Command "Expand-Archive -Path '%LATEST_ZIP%' -DestinationPath '%TEMP_DIR%' -Force"

if errorlevel 1 (
    echo [错误] 解压失败！
    rmdir /s /q "%TEMP_DIR%" 2>nul
    pause
    exit /b 1
)

REM 复制文件覆盖插件目录
xcopy /e /y /q "%TEMP_DIR%\*" "%PLUGIN_DIR%\" >nul

if errorlevel 1 (
    echo [错误] 文件复制失败！
    rmdir /s /q "%TEMP_DIR%" 2>nul
    pause
    exit /b 1
)

REM 清理临时目录
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo ========================================
echo   更新完成！
echo ========================================
echo.
echo 接下来请操作：
echo   1. Chrome 地址栏输入 chrome://extensions/
echo   2. 找到「任务批量领取助手」点刷新按钮
echo   3. 刷新质检平台页面即可
echo.
pause
