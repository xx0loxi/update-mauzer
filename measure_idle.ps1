param([int]$seconds = 15)
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$p1 = Get-Process electron -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum
if (-not $p1.Sum) { Write-Output "ERROR: no electron processes"; exit 1 }
Start-Sleep -Seconds $seconds
$p2 = Get-Process electron -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum
$cpuSeconds = [math]::Round(($p2.Sum - $p1.Sum), 2)
$percent = [math]::Round(($cpuSeconds / ($seconds * $cores)) * 100, 1)
Write-Output "cores=$cores deltaCPU=${cpuSeconds}s over ${seconds}s -> ${percent}% total CPU"
