@echo off
REM Rebuilds docs\data\report.json from the Excel files.
cd /d "%~dp0"
python -m pip install -q -r requirements.txt
python builder\build_data.py
echo.
echo Done. Now commit and push the changes (GitHub Desktop: Commit to main, then Push origin).
pause
