@echo off
rem Builds ..\EasyMeta.exe from EasyMeta.cs with the C# compiler that ships with
rem the .NET Framework in Windows (no Visual Studio or SDK needed).
setlocal
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Could not find csc.exe from the .NET Framework 4.
  exit /b 1
)
"%CSC%" /nologo /target:winexe /optimize+ /win32icon:easymeta.ico /reference:System.Windows.Forms.dll /out:..\EasyMeta.exe EasyMeta.cs
if errorlevel 1 exit /b 1
echo Built ..\EasyMeta.exe
