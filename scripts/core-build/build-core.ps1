# ============================================================
# MAUZER CORE BUILD — сборка урезанного ядра Electron 22.3.27
# Использование:  powershell -ExecutionPolicy Bypass -File build-core.ps1 [-RootDir D:\mauzer-core]
# Весь цикл: проверка окружения -> исходники -> args.gn -> сборка -> zip.
# ============================================================
param(
    [string]$RootDir = "D:\mauzer-core",
    [string]$ElectronVersion = "22.3.27"
)
$ErrorActionPreference = "Stop"
$sw = [Diagnostics.Stopwatch]::StartNew()

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Need($ok, $m) { if (-not $ok) { Write-Host "X $m" -ForegroundColor Red; exit 1 } }

# ---------- 0. Проверки окружения ----------
Step "Проверки"
$drive = (Get-PSDrive -Name $RootDir.Substring(0,1) -ErrorAction SilentlyContinue)
Need ($null -ne $drive) "Диск $($RootDir.Substring(0,1)): не найден"
Need ($drive.Free/1GB -ge 90) ("На диске надо 90+ ГБ свободно, сейчас: {0:N0} ГБ" -f ($drive.Free/1GB))
Need (Get-Command git -ErrorAction SilentlyContinue) "git не найден (установи Git for Windows)"
Need (Get-Command python -ErrorAction SilentlyContinue) "python не найден (нужен 3.8+)"
# Visual Studio C++ toolset (нужен линкеру)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVs = ($vswhere -and (Test-Path $vswhere) -and (Get-Content "$vswhere" -ErrorAction SilentlyContinue | Out-String).Length -gt 0 -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null))
Need $hasVs "Visual Studio 2022 BuildTools (C++) не найдена. Установка:`n  winget install Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended --add Microsoft.VisualStudio.Component.Windows11SDK.22000`"`n  (или поставь через Visual Studio Installer: рабочая нагрузка 'Разработка классических приложений на C++')"
Write-Host "OK: окружение выглядит готовым"

# ---------- 1. depot_tools ----------
Step "depot_tools"
if (-not (Get-Command gn -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path "$RootDir\depot_tools")) {
        git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$RootDir\depot_tools"
    }
    $env:PATH = "$RootDir\depot_tools;$env:PATH"
}
$env:DEPOT_TOOLS_WIN_TOOLCHAIN = "0"   # обязательно для сборки НЕ сотрудником Google
Write-Host "OK"

# ---------- 2. Исходники ----------
Step "Исходники Electron v$ElectronVersion (скачивается ~30 ГБ, это долго)"
New-Item -ItemType Directory -Force -Path "$RootDir\src" | Out-Null
if (-not (Test-Path "$RootDir\src\electron\.git")) {
    git clone --branch "v$ElectronVersion" --depth 1 https://github.com/electron/electron "$RootDir\src\electron"
}
if (-not (Test-Path "$RootDir\.gclient")) {
    Push-Location $RootDir
    gclient config --name="src/electron" --unmanaged https://github.com/electron/electron
    Pop-Location
}
# Синхронизация зависимостей Chromium (самый долгий этап загрузки)
Push-Location $RootDir
gclient sync --with_branch_heads --with_tags --no-history
Pop-Location
Write-Host "OK: исходники на месте"

# ---------- 3. Урезанный конфиг ----------
Step "args.gn (вырезаем лишнее)"
$outDir = "$RootDir\src\out\Default"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item "$PSScriptRoot\args.gn" "$outDir\args.gn" -Force
Push-Location $RootDir\src
gn gen out/Default
Pop-Location
Write-Host "OK: конфиг урезания применён"

# ---------- 4. Сборка (самое долгое) ----------
Step "Сборка ядра (на 6C/8GB — многие часы, ноут будет греться)"
Push-Location $RootDir\src
ninja -C out/Default electron:electron_dist_zip
Pop-Location

# ---------- 5. Результат ----------
Step "Упаковка результата"
New-Item -ItemType Directory -Force -Path "$RootDir\result" | Out-Null
$zip = "$RootDir\result\electron-v$ElectronVersion-mauzer-core.zip"
Move-Item "$RootDir\src\out\Default\dist.zip" $zip -Force
$sw.Stop()
Write-Host ""
Write-Host "=== ГОТОВО за $([int]($sw.Elapsed.TotalHours)) ч $($sw.Elapsed.Minutes) мин ===" -ForegroundColor Green
Write-Host "Ядро: $zip"
Write-Host "Дальше: распакуй в node_modules\electron\dist в проекте Mauzer (заменить electron.exe и файлы), затем npm run build как обычно."
