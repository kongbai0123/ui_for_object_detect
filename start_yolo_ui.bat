@echo off
cls
echo =======================================================================
echo   Vision Training Studio Launcher (v2.0)
echo   Working Directory: %~dp0
echo =======================================================================

REM Check if this folder actually has the new Vision Training Studio index.html
findstr /C:"Vision Training Studio" "%~dp0algorithm\yolo_ui\index.html" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This folder does not contain the new Vision Training Studio index.html!
    echo Please ensure you are running the correct script under D:\software\yolo
    echo.
    pause
    exit /b 1
)

echo   Starting services in the background and loading UI in browser...
echo   This window will close automatically in 5 seconds.
echo =======================================================================
wscript "%~dp0start_yolo_ui.vbs"
ping 127.0.0.1 -n 6 >nul
exit
