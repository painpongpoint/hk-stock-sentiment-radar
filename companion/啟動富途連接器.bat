@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo [錯誤] 未找到 Python。請先安裝 Python 3.11 或以上版本。
  echo https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo 正在建立本機環境，首次執行約需一至三分鐘...
  py -3 -m venv .venv
  if errorlevel 1 goto :failed
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
  if errorlevel 1 goto :failed
)

echo 正在啟動富途本機連接器...
".venv\Scripts\python.exe" futu_connector.py
exit /b %errorlevel%

:failed
echo.
echo [錯誤] 安裝未完成，請檢查網絡及 Python 安裝後重試。
pause
exit /b 1
