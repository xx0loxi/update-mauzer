param([int]$seconds = 10)
function Snap {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ForEach-Object {
    [pscustomobject]@{ PID = $_.ProcessId; CPU = ($_.KernelModeTime + $_.UserModeTime) / 10000000; Cmd = $_.CommandLine }
  }
}
$a = Snap
Start-Sleep -Seconds $seconds
$b = Snap
$cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
$map = @{}
foreach ($p in $a) { $map[$p.PID] = $p.CPU }
foreach ($p in $b) {
  $d = [math]::Round($p.CPU - $map[$p.PID], 2)
  if ($d -ge 0.05) {
    $cmd = $p.Cmd
    if ($cmd.Length -gt 110) {
      # keep the interesting tail: type=renderer / utility kind
      $cmd = ($cmd -split ' ') | Where-Object { $_ -match '^--type=|^--user-data|electron.exe' } | Select-Object -First 3
      $cmd = $cmd -join ' '
    }
    $pct = [math]::Round($d / $seconds * 100, 1)
    Write-Output ("pid={0} cpu={1}s ({2}% of one core) {3}" -f $p.PID, $d, $pct, $cmd)
  }
}
