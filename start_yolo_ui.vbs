Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonScript = currentDir & "\algorithm\yolo_ui\server.py"
logFile = currentDir & "\backend_err.log"

Set WshShell = CreateObject("WScript.Shell")

' Stop any old server still bound to port 8000 before launching this copy.
killCmd = "cmd.exe /c for /f ""tokens=5"" %a in ('netstat -ano ^| findstr "":8000"" ^| findstr ""LISTENING""') do taskkill /F /PID %a >nul 2>&1"
WshShell.Run killCmd, 0, True

' Run command, redirect stdout and stderr to log file, keep hidden
cmdStr = "cmd.exe /c python """ & pythonScript & """ > """ & logFile & """ 2>&1"
WshShell.Run cmdStr, 0, False

' Wait 2 seconds to ensure server starts
WScript.Sleep 2000

' Launch default browser with a cache-busting query string
WshShell.Run "http://127.0.0.1:8000/?v=" & Replace(CStr(Timer), ".", "")
