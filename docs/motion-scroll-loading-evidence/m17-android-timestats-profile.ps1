param([switch]$AnalyzeExisting)

$ErrorActionPreference = 'Stop'

$adb = 'D:\android\platform-tools\adb.exe'
$device = 'RF8R321M9LJ'
$package = 'com.example.yaskapp_mobile'
$periodNs = 11111111
$evidenceDir = $PSScriptRoot
$runs = @()

if ($AnalyzeExisting) {
  $layerLine = Select-String -Path (Join-Path $evidenceDir 'm17-android-timestats-run-1.txt') -Pattern '^layerName = SurfaceView\[com\.example\.yaskapp_mobile/.+\]@0\(BLAST\)#\d+$' | Select-Object -First 1
  $layer = $layerLine.Line -replace '^layerName = ', ''
} else {
  $layers = & $adb -s $device shell dumpsys SurfaceFlinger --list
  $layer = $layers | Where-Object { $_ -match "^SurfaceView\[$([regex]::Escape($package))/.+\]@0\(BLAST\)#\d+$" } | Select-Object -Last 1
  if (-not $layer) { throw "Flutter SurfaceView BLAST layer not found for $package" }
  $layer = $layer.Trim()
}
if (-not $layer) { throw "Flutter SurfaceView BLAST layer not found in saved evidence for $package" }
if (-not $AnalyzeExisting) {
  $latencyHeader = & $adb -s $device shell "dumpsys SurfaceFlinger --latency '$layer'" | Select-Object -First 1
  if ($latencyHeader -notmatch '^\d+$') { throw "Could not read SurfaceFlinger display period for $layer" }
  $periodNs = [long]$latencyHeader
}

for ($run = 1; $run -le 3; $run++) {
  $path = Join-Path $evidenceDir "m17-android-timestats-run-$run.txt"
  $measurementPath = Join-Path $evidenceDir "m17-android-timestats-run-$run-measurement.txt"
  if (-not $AnalyzeExisting) {
    & $adb -s $device shell dumpsys SurfaceFlinger --timestats -clear -enable | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not clear/enable SurfaceFlinger TimeStats for run $run" }
    & $adb -s $device shell "dumpsys SurfaceFlinger --latency-clear '$layer'" | Out-Null

    $timer = [Diagnostics.Stopwatch]::StartNew()
    for ($swipe = 0; $swipe -lt 75; $swipe++) {
      if ($swipe % 2 -eq 0) {
        & $adb -s $device shell input swipe 540 1850 540 520 300
      } else {
        & $adb -s $device shell input swipe 540 520 540 1850 300
      }
    }
    $timer.Stop()
    $text = & $adb -s $device shell dumpsys SurfaceFlinger --timestats -dump -maxlayers 100
    $text | Set-Content -Encoding utf8 $path
    "elapsed_seconds=$([Math]::Round($timer.Elapsed.TotalSeconds,2)) swipes=75" | Set-Content -Encoding ascii $measurementPath
  } else {
    $text = Get-Content $path
    $timer = [Diagnostics.Stopwatch]::new()
  }

  $layerHeader = "layerName = $layer"
  $start = [Array]::IndexOf([string[]]$text, $layerHeader)
  if ($start -lt 0) { throw "TimeStats did not report the Flutter layer for run ${run}: $layer" }
  $end = $text.Length
  for ($i = $start + 1; $i -lt $text.Length; $i++) {
    if ($text[$i] -like 'layerName = *') { $end = $i; break }
  }
  $section = $text[$start..($end - 1)] -join "`n"
  $frames = [int]([regex]::Match($section, '(?m)^totalFrames = (\d+)$').Groups[1].Value)
  $janky = [int]([regex]::Match($section, '(?m)^jankyFrames = (\d+)$').Groups[1].Value)
  $timelineFrames = [int]([regex]::Match($section, '(?m)^totalTimelineFrames = (\d+)$').Groups[1].Value)
  $histMatch = [regex]::Match($section, '(?m)^present2present histogram is as below:\s*\r?\n([^\r\n]+)\r?\n(avg [^\r\n]+)$')
  if (-not $histMatch.Success) { throw "present2present histogram missing for run $run" }

  $buckets = @{}
  foreach ($match in [regex]::Matches($histMatch.Groups[1].Value, '(\d+)ms=(\d+)')) {
    $count = [int]$match.Groups[2].Value
    if ($count -gt 0) { $buckets[$match.Groups[1].Value] = $count }
  }
  $sampleCount = ($buckets.Values | Measure-Object -Sum).Sum
  $overBudget = 0
  $p95Index = [int][Math]::Round(($sampleCount - 1) * 0.95)
  $p95Ms = $null
  $seen = 0
  foreach ($bucketKey in ($buckets.Keys | Sort-Object { [int]$_ })) {
    $bucket = [int]$bucketKey
    $count = $buckets[$bucketKey]
    if ($bucket * 1000000 -gt $periodNs) { $overBudget += $count }
    if ($null -eq $p95Ms -and $seen + $count -gt $p95Index) { $p95Ms = $bucket }
    $seen += $count
  }
  $avgLine = [regex]::Match($histMatch.Groups[2].Value, 'avg ([0-9.]+), max (\d+), min (\d+)')

  $runs += [pscustomobject]@{
    run = $run
    elapsedSeconds = if ($AnalyzeExisting) { [double]([regex]::Match((Get-Content $measurementPath -Raw), 'elapsed_seconds=([0-9.]+)').Groups[1].Value) } else { [Math]::Round($timer.Elapsed.TotalSeconds, 2) }
    swipes = 75
    frameLayer = $layer
    displayPeriodNs = $periodNs
    totalFrames = $frames
    surfaceFlingerJankyFrames = $janky
    frameTimelineClassifiedFrames = $timelineFrames
    presentIntervalSamples = $sampleCount
    intervalsOver90HzBudget = $overBudget
    overBudgetPercent = [Math]::Round(100 * $overBudget / [Math]::Max(1, $sampleCount), 4)
    presentIntervalP95HistogramMs = $p95Ms
    presentIntervalAverageMs = [double]$avgLine.Groups[1].Value
    presentIntervalMaxHistogramMs = [int]$avgLine.Groups[2].Value
    presentIntervalMinHistogramMs = [int]$avgLine.Groups[3].Value
    histogram = $buckets
    sourceFile = [IO.Path]::GetFileName($path)
  }
  "elapsed_seconds=$([Math]::Round($runs[-1].elapsedSeconds,2)) swipes=75 frames=$frames over_budget=$overBudget/$sampleCount" | Set-Content -Encoding ascii $measurementPath
}

$summary = [pscustomobject]@{
  date = (Get-Date -Format 'yyyy-MM-dd')
  device = 'Samsung SM-A325F / Android 13 API 33'
  displayPeriodNs = $periodNs
  frameSource = 'SurfaceFlinger TimeStats on Flutter SurfaceView BLAST layer'
  lateCadenceDefinition = 'present2present histogram intervals greater than the active 90 Hz display period; this is presentation-cadence evidence, not FrameTimeline jank classification'
  runs = $runs
}
$summary | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $evidenceDir 'm17-android-timestats-summary.json')
if (-not $AnalyzeExisting) { & $adb -s $device shell dumpsys SurfaceFlinger --timestats -disable | Out-Null }
$summary | ConvertTo-Json -Depth 8
