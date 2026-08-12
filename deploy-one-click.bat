@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "DEFAULT_BRANCH=main"
set "FIREBASE_PROJECT=gen-lang-client-0815966909"
set "FIREBASE_URL=https://gen-lang-client-0815966909.web.app"

cd /d "%~dp0"

echo =====================================
echo Aura Fitness - GitHub + Firebase Deploy
echo =====================================

if not exist ".git" (
  echo [ERR] Khong phai thu muc Git Repository.
  pause
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo [ERR] Khong tim thay Git trong PATH.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERR] Khong tim thay Node.js/npm trong PATH.
  pause
  exit /b 1
)

for /f "delims=" %%b in ('git branch --show-current') do set "CURRENT_BRANCH=%%b"
if "%CURRENT_BRANCH%"=="" (
  echo [ERR] Khong lay duoc branch hien tai.
  pause
  exit /b 1
)

set "TARGET_BRANCH=%~1"
if "%TARGET_BRANCH%"=="" set "TARGET_BRANCH=%DEFAULT_BRANCH%"

echo [1/9] Branch hien tai: %CURRENT_BRANCH%
echo [1/9] Branch muc tieu : %TARGET_BRANCH%

if /I not "%CURRENT_BRANCH%"=="%TARGET_BRANCH%" (
  echo [WARN] Dang chuyen sang branch "%TARGET_BRANCH%"...
  git switch "%TARGET_BRANCH%"
  if errorlevel 1 (
    echo [ERR] Khong chuyen duoc sang branch %TARGET_BRANCH%.
    pause
    exit /b 1
  )
)

echo [2/9] Dong bo voi GitHub...
git fetch origin
if errorlevel 1 (
  echo [ERR] Fetch GitHub that bai. Kiem tra ket noi hoac dang nhap Git.
  pause
  exit /b 1
)

git pull --rebase origin "%TARGET_BRANCH%"
if errorlevel 1 (
  echo [ERR] Rebase that bai. Hay xu ly xung dot Git truoc khi deploy.
  pause
  exit /b 1
)

set "HAS_CHANGE="
for /f "delims=" %%s in ('git status --porcelain') do set "HAS_CHANGE=1"

if defined HAS_CHANGE (
  echo [ERR] Repo dang co thay doi chua commit:
  git status --short
  echo [INFO] Hay commit cac file can deploy truoc khi chay script.
  pause
  exit /b 1
) else (
  echo [3/9] Repo sach, san sang deploy.
)

echo [4/9] Push branch %TARGET_BRANCH% len GitHub...
git push -u origin "%TARGET_BRANCH%"
if errorlevel 1 (
  echo [ERR] Push that bai. Kiem tra quyen GitHub da luu tren may.
  pause
  exit /b 1
)

echo [5/9] Build ban production...
call npm.cmd run build
if errorlevel 1 (
  echo [ERR] Build that bai. Khong deploy ban loi.
  pause
  exit /b 1
)

echo [6/9] Cai dependencies cho Firebase Functions...
call npm.cmd --prefix functions ci
if errorlevel 1 (
  echo [ERR] Khong cai duoc dependencies cua Functions.
  pause
  exit /b 1
)

echo [7/9] Kiem tra Firebase Functions...
call npm.cmd --prefix functions run check
if errorlevel 1 (
  echo [ERR] Functions check that bai. Khong deploy ban loi.
  pause
  exit /b 1
)

echo [8/9] Deploy Gemini Functions va Storage Rules...
where firebase.cmd >nul 2>&1
if errorlevel 1 (
  call npx.cmd --yes firebase-tools deploy --only "functions:analyzeFoodImage,functions:generateMealReview,functions:askAiCoach,functions:generateAuraContent,storage" --project "%FIREBASE_PROJECT%"
) else (
  call firebase.cmd deploy --only "functions:analyzeFoodImage,functions:generateMealReview,functions:askAiCoach,functions:generateAuraContent,storage" --project "%FIREBASE_PROJECT%"
)
if errorlevel 1 (
  echo [ERR] Gemini Functions deploy that bai. Kiem tra Firebase va GEMINI_API_KEY.
  pause
  exit /b 1
)

echo [9/9] Deploy Firebase Hosting...
where firebase.cmd >nul 2>&1
if errorlevel 1 (
  call npx.cmd --yes firebase-tools deploy --only hosting --project "%FIREBASE_PROJECT%"
) else (
  call firebase.cmd deploy --only hosting --project "%FIREBASE_PROJECT%"
)
if errorlevel 1 (
  echo [ERR] Firebase Hosting deploy that bai. Kiem tra phien dang nhap Firebase.
  pause
  exit /b 1
)

echo [9/9] Hoan tat.
echo.
echo [OK] GitHub va Firebase da duoc cap nhat.
echo - Branch: %TARGET_BRANCH%
echo - Website: %FIREBASE_URL%
echo.
pause
exit /b 0
