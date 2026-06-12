Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
pythonScript = currentDir & "\algorithm\yolo_ui\server.py"
logFile = currentDir & "\backend_err.log"

Set WshShell = CreateObject("WScript.Shell")
' Run command, redirect stdout and stderr to log file, keep hidden
cmdStr = "cmd.exe /c python """ & pythonScript & """ > """ & logFile & """ 2>&1"
WshShell.Run cmdStr, 0, False

' Wait 2 seconds to ensure server starts
WScript.Sleep 2000

' Launch default browser
WshShell.Run "http://127.0.0.1:8000"
