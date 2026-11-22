# ClipHunter Helper - background tray app (Windows).
#
# Started hidden by "ClipHunter Helper.vbs". Runs the helper (node app\helper.cjs)
# with no window, keeps it running (restarts it if it stops), shows a tray icon
# with status + menu, and can start itself with Windows.
#
# KEEP THIS FILE ASCII-ONLY: Windows PowerShell 5.1 reads scripts without a BOM
# using the ANSI code page, so any non-ASCII character would be garbled.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $AppDir
$Node = Join-Path $Root 'node\node.exe'
$Helper = Join-Path $AppDir 'helper.cjs'
$Launcher = Join-Path $Root 'ClipHunter Helper.vbs'
$DataDir = Join-Path $env:APPDATA 'ClipHunter'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$LogFile = Join-Path $DataDir 'helper.log'
$FirstRunMarker = Join-Path $DataDir 'tray-installed'
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'ClipHunter Helper.lnk'
$Footage = if ($env:CLIPHUNTER_FOOTAGE_DIR) { $env:CLIPHUNTER_FOOTAGE_DIR } else { Join-Path ([Environment]::GetFolderPath('MyVideos')) 'ClipHunter' }
$Config = Get-Content (Join-Path $AppDir 'config.json') -Raw | ConvertFrom-Json
$AppUrl = $Config.CLIPHUNTER_APP_URL

# --- one tray icon per user -----------------------------------------------------
$created = $false
$Mutex = New-Object System.Threading.Mutex($true, 'Local\ClipHunterHelperTray', [ref]$created)
if (-not $created) {
  [System.Windows.Forms.MessageBox]::Show('ClipHunter Helper is already running. Look for its icon near the clock (you may need to click the ^ arrow).', 'ClipHunter Helper') | Out-Null
  exit
}

# --- environment for the helper process (inherited) ------------------------------
$env:PATH = "$Root\bin;$AppDir\node_modules\@remotion\compositor-win32-x64-msvc;$env:PATH"
$env:CLIPHUNTER_CONFIG = Join-Path $AppDir 'config.json'
$env:CLIPHUNTER_REMOTION_BUNDLE = Join-Path $AppDir 'remotion-bundle'
$env:CLIPHUNTER_FOOTAGE_DIR = $Footage

# --- icon -----------------------------------------------------------------------
function New-TrayIcon([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $color
  $g.FillEllipse($brush, 1, 1, 30, 30)
  $font = New-Object System.Drawing.Font('Segoe UI', 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('C', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, 1, 32, 32)), $sf)
  $g.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$IconOk = New-TrayIcon ([System.Drawing.Color]::FromArgb(139, 92, 246))
$IconWarn = New-TrayIcon ([System.Drawing.Color]::FromArgb(234, 88, 12))

$Tray = New-Object System.Windows.Forms.NotifyIcon
$Tray.Icon = $IconOk
$Tray.Text = 'ClipHunter Helper - starting'
$Tray.Visible = $true

function Show-Balloon([string]$title, [string]$text, [string]$kind = 'Info') {
  $Tray.BalloonTipTitle = $title
  $Tray.BalloonTipText = $text
  $Tray.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::$kind
  $Tray.ShowBalloonTip(5000)
}

# --- helper process ---------------------------------------------------------------
$script:Worker = $null
$script:SignIn = $null
$script:State = 'starting'      # running | signin | restarting | stopped
$script:RestartAt = [DateTime]::MinValue
$script:Backoff = 5
$script:StartedAt = [DateTime]::Now
$script:LogPos = 0L

function Stop-Tree($proc) {
  if ($proc -and -not $proc.HasExited) {
    & taskkill.exe /PID $proc.Id /T /F 2>$null | Out-Null
  }
}

function Start-Worker {
  if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 5MB) {
    Move-Item -Force $LogFile (Join-Path $DataDir 'helper.old.log')
  }
  if (Test-Path $LogFile) { $script:LogPos = (Get-Item $LogFile).Length } else { $script:LogPos = 0L }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/c `"`"$Node`" --no-deprecation `"$Helper`" --background >> `"$LogFile`" 2>&1`""
  $psi.WorkingDirectory = $AppDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $script:Worker = [System.Diagnostics.Process]::Start($psi)
  $script:StartedAt = [DateTime]::Now
  $script:State = 'running'
  $Tray.Icon = $IconOk
}

function Start-SignIn([switch]$SwitchAccount) {
  if ($script:SignIn -and -not $script:SignIn.HasExited) { return }
  Stop-Tree $script:Worker
  $extra = if ($SwitchAccount) { ' --logout' } else { '' }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/c `"title ClipHunter Helper - sign in & chcp 65001 >nul & `"$Node`" --no-deprecation `"$Helper`" --signin$extra`""
  $psi.WorkingDirectory = $AppDir
  $psi.UseShellExecute = $false
  $script:SignIn = [System.Diagnostics.Process]::Start($psi)
  $script:State = 'signin'
  $Tray.Icon = $IconWarn
}

# --- start with Windows -------------------------------------------------------------
function Set-Autostart([bool]$on) {
  if ($on) {
    $sh = New-Object -ComObject WScript.Shell
    $lnk = $sh.CreateShortcut($StartupLink)
    $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $lnk.Arguments = "`"$Launcher`""
    $lnk.WorkingDirectory = $Root
    $lnk.Description = 'ClipHunter Helper'
    $lnk.Save()
  } elseif (Test-Path $StartupLink) {
    Remove-Item -Force $StartupLink
  }
}
if (-not (Test-Path $FirstRunMarker)) {
  Set-Autostart $true
  Set-Content -Path $FirstRunMarker -Value 'autostart enabled on first run' -Encoding ASCII
  Show-Balloon 'ClipHunter Helper is running' 'It works in the background and starts with Windows. Right-click this icon for options.'
}

# --- menu -----------------------------------------------------------------------------
$Menu = New-Object System.Windows.Forms.ContextMenuStrip
$StatusItem = $Menu.Items.Add('Starting...')
$StatusItem.Enabled = $false
[void]$Menu.Items.Add('-')
if ($AppUrl) {
  $openSite = $Menu.Items.Add('Open ClipHunter')
  $openSite.add_Click({ Start-Process $AppUrl })
}
$openFolder = $Menu.Items.Add('Open footage folder')
$openFolder.add_Click({
  New-Item -ItemType Directory -Force -Path $Footage | Out-Null
  Start-Process explorer.exe $Footage
})
$openLog = $Menu.Items.Add('View activity log')
$openLog.add_Click({ if (Test-Path $LogFile) { Start-Process notepad.exe $LogFile } })
[void]$Menu.Items.Add('-')
$restart = $Menu.Items.Add('Restart helper')
$restart.add_Click({
  Stop-Tree $script:Worker
  Start-Worker
})
$switch = $Menu.Items.Add('Sign in / switch account...')
$switch.add_Click({ if ($script:State -eq 'needsignin') { Start-SignIn } else { Start-SignIn -SwitchAccount } })
$auto = New-Object System.Windows.Forms.ToolStripMenuItem 'Start with Windows'
$auto.Checked = Test-Path $StartupLink
$auto.add_Click({
  $auto.Checked = -not $auto.Checked
  Set-Autostart $auto.Checked
})
[void]$Menu.Items.Add($auto)
[void]$Menu.Items.Add('-')
$quit = $Menu.Items.Add('Quit')
$quit.add_Click({
  $script:State = 'stopped'
  $Timer.Stop()
  Stop-Tree $script:Worker
  $Tray.Visible = $false
  $Tray.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$Tray.ContextMenuStrip = $Menu
$Tray.add_DoubleClick({ if ($AppUrl) { Start-Process $AppUrl } else { Start-Process explorer.exe $Footage } })

# --- watch the helper + log ----------------------------------------------------------
$Check = [string][char]0x2714   # check mark the helper prints for finished jobs

function Read-NewLogLines {
  if (-not (Test-Path $LogFile)) { return @() }
  $len = (Get-Item $LogFile).Length
  if ($len -lt $script:LogPos) { $script:LogPos = 0L }
  if ($len -eq $script:LogPos) { return @() }
  $fs = [System.IO.File]::Open($LogFile, 'Open', 'Read', 'ReadWrite')
  try {
    [void]$fs.Seek($script:LogPos, 'Begin')
    $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $script:LogPos = $len
    return $text -split "`r?`n" | Where-Object { $_.Trim() }
  } finally { $fs.Dispose() }
}

function Set-Status([string]$text) {
  $short = $text -replace '^\[[^\]]+\]\s*', ''
  if ($short.Length -gt 60) { $short = $short.Substring(0, 57) + '...' }
  $StatusItem.Text = $short
  $tip = "ClipHunter Helper - $short"
  if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 60) + '...' }
  $Tray.Text = $tip
}

$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 2000
$Timer.add_Tick({
  try {
    if ($script:State -eq 'stopped') { return }

    if ($script:State -eq 'signin') {
      if ($script:SignIn -and $script:SignIn.HasExited) {
        $code = $script:SignIn.ExitCode
        $script:SignIn = $null
        if ($code -eq 0) { Start-Worker; Show-Balloon 'ClipHunter Helper' 'Signed in. Working in the background.' }
        else { Set-Status 'Sign-in needed - right-click > Sign in'; $script:State = 'needsignin' }
      } else { Set-Status 'Waiting for you to sign in...' }
      return
    }
    if ($script:State -eq 'needsignin') { return }

    if ($script:State -eq 'restarting') {
      if ([DateTime]::Now -ge $script:RestartAt) { Start-Worker }
      return
    }

    foreach ($line in (Read-NewLogLines)) {
      Set-Status $line
      if ($line.Contains("$Check Rendered")) { Show-Balloon 'Short rendered' ($line -replace '^.*Rendered\s*', '') }
      elseif ($line.Contains("$Check Ready to download")) { Show-Balloon 'Download ready' 'Your browser will save the MP4.' }
    }

    if ($script:Worker -and $script:Worker.HasExited) {
      $code = $script:Worker.ExitCode
      if ($code -eq 2) {
        Set-Status 'Sign-in needed'
        Show-Balloon 'ClipHunter Helper' 'Please sign in with your ClipHunter account.' 'Warning'
        Start-SignIn
        return
      }
      # crashed or lost the connection: retry, waiting longer each time (max 2 min)
      if (([DateTime]::Now - $script:StartedAt).TotalMinutes -gt 5) { $script:Backoff = 5 }
      $script:RestartAt = [DateTime]::Now.AddSeconds($script:Backoff)
      Set-Status "Stopped (code $code) - restarting in $($script:Backoff)s"
      $script:Backoff = [Math]::Min(120, $script:Backoff * 2)
      $script:State = 'restarting'
      $Tray.Icon = $IconWarn
    }
  } catch {
    Set-Status "Error: $($_.Exception.Message)"
  }
})

Start-Worker
$Timer.Start()
$Context = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($Context)
$Mutex.ReleaseMutex()
