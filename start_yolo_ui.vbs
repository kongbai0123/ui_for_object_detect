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

' Build message safely using step-by-step concatenation to prevent syntax and encoding encoding errors
Dim msg
msg = "Vision Training Studio v2.0 已成功啟動！" & vbCrLf & vbCrLf
msg = msg & "本平台已重構為符合模型生命週期的 4 大核心流程：" & vbCrLf
msg = msg & "  1. 資料庫 (Dataset Database)" & vbCrLf
msg = msg & "  2. 標註中心 (Annotation Center)" & vbCrLf
msg = msg & "  3. 樣本分配 (Sample Distribution)" & vbCrLf
msg = msg & "  4. 模型訓練 (Model Training)" & vbCrLf & vbCrLf
msg = msg & "系統已在背景拉起 FastAPI 服務，並在預設瀏覽器中載入首頁。"

' Display update message box
MsgBox msg, 64, "Vision Training Studio - 更新通知"
