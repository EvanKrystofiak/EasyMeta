@echo off
rem Opens EasyMeta in its own Edge window (use this if EasyMeta.exe is blocked).
set "HTML=%~dp0EasyMeta.html"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app="file:///%HTML:\=/%" --window-size=1480,940
) else (
  start "" "%HTML%"
)
