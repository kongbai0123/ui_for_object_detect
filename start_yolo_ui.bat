@echo off
cls
echo =======================================================================
echo   Vision Training Studio (v2.0)
echo =======================================================================
echo   Starting services in the background and loading UI in browser...
echo   This window will close automatically in 5 seconds.
echo =======================================================================
wscript "%~dp0start_yolo_ui.vbs"
ping 127.0.0.1 -n 6 >nul
exit
