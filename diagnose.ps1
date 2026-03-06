# IIS Diagnostic Script
# Run as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "IIS Diagnostic Report" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$siteName = "FootballPlatform"
$projectPath = "C:\KiroProjects"

# Check 1: Node.js
Write-Host "1. Checking Node.js..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "   ✓ Node.js installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "   ✗ Node.js NOT found" -ForegroundColor Red
}
Write-Host ""

# Check 2: iisnode
Write-Host "2. Checking iisnode..." -ForegroundColor Yellow
$iisnodePath = "${env:ProgramFiles}\iisnode\iisnode.dll"
if (Test-Path $iisnodePath) {
    Write-Host "   ✓ iisnode installed at: $iisnodePath" -ForegroundColor Green
} else {
    Write-Host "   ✗ iisnode NOT found" -ForegroundColor Red
}
Write-Host ""

# Check 3: Project files
Write-Host "3. Checking project files..." -ForegroundColor Yellow
if (Test-Path "$projectPath\server.js") {
    Write-Host "   ✓ server.js exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ server.js NOT found" -ForegroundColor Red
}

if (Test-Path "$projectPath\web.config") {
    Write-Host "   ✓ web.config exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ web.config NOT found" -ForegroundColor Red
}

if (Test-Path "$projectPath\node_modules") {
    Write-Host "   ✓ node_modules exists" -ForegroundColor Green
} else {
    Write-Host "   ✗ node_modules NOT found (run: npm install)" -ForegroundColor Red
}
Write-Host ""

# Check 4: IIS Site
Write-Host "4. Checking IIS site..." -ForegroundColor Yellow
Import-Module WebAdministration -ErrorAction SilentlyContinue

if (Test-Path "IIS:\Sites\$siteName") {
    $site = Get-Website -Name $siteName
    Write-Host "   ✓ Site exists: $siteName" -ForegroundColor Green
    Write-Host "   State: $($site.State)" -ForegroundColor $(if($site.State -eq "Started"){"Green"}else{"Red"})
    Write-Host "   Physical Path: $($site.PhysicalPath)" -ForegroundColor White
    
    $binding = $site.bindings.Collection[0]
    Write-Host "   Binding: $($binding.protocol)://$($binding.bindingInformation)" -ForegroundColor White
} else {
    Write-Host "   ✗ Site NOT found: $siteName" -ForegroundColor Red
}
Write-Host ""

# Check 5: Application Pool
Write-Host "5. Checking Application Pool..." -ForegroundColor Yellow
$appPoolName = "FootballPlatformAppPool"
if (Test-Path "IIS:\AppPools\$appPoolName") {
    $appPool = Get-WebAppPoolState -Name $appPoolName
    Write-Host "   ✓ App Pool exists: $appPoolName" -ForegroundColor Green
    Write-Host "   State: $($appPool.Value)" -ForegroundColor $(if($appPool.Value -eq "Started"){"Green"}else{"Red"})
} else {
    Write-Host "   ✗ App Pool NOT found: $appPoolName" -ForegroundColor Red
}
Write-Host ""

# Check 6: Port availability
Write-Host "6. Checking port 8088..." -ForegroundColor Yellow
$portInUse = Get-NetTCPConnection -LocalPort 8088 -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "   ✓ Port 8088 is in use (something is listening)" -ForegroundColor Green
    $process = Get-Process -Id $portInUse.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "   Process: $($process.ProcessName) (PID: $($process.Id))" -ForegroundColor White
    }
} else {
    Write-Host "   ✗ Port 8088 is NOT in use (nothing listening)" -ForegroundColor Red
}
Write-Host ""

# Check 7: Permissions
Write-Host "7. Checking folder permissions..." -ForegroundColor Yellow
$acl = Get-Acl $projectPath
$hasIISPermissions = $acl.Access | Where-Object { $_.IdentityReference -like "*IIS_IUSRS*" }
if ($hasIISPermissions) {
    Write-Host "   ✓ IIS_IUSRS has permissions" -ForegroundColor Green
} else {
    Write-Host "   ✗ IIS_IUSRS does NOT have permissions" -ForegroundColor Red
}
Write-Host ""

# Check 8: iisnode logs
Write-Host "8. Checking iisnode logs..." -ForegroundColor Yellow
$logPath = "$projectPath\iisnode"
if (Test-Path $logPath) {
    $logs = Get-ChildItem $logPath -Filter "*.txt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($logs) {
        Write-Host "   ✓ Log folder exists with logs" -ForegroundColor Green
        Write-Host "   Latest log: $($logs.Name)" -ForegroundColor White
        Write-Host "   Last modified: $($logs.LastWriteTime)" -ForegroundColor White
        Write-Host ""
        Write-Host "   Last 10 lines of log:" -ForegroundColor Cyan
        Get-Content $logs.FullName -Tail 10 | ForEach-Object { Write-Host "   $_" -ForegroundColor Gray }
    } else {
        Write-Host "   ⚠ Log folder exists but no logs found" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ✗ iisnode log folder does NOT exist" -ForegroundColor Red
    Write-Host "   This means iisnode hasn't been triggered yet" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Diagnostic Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to exit"
