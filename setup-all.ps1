# Football Platform - Complete IIS Setup Script
# Run this script as Administrator
# Right-click and select "Run with PowerShell"

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Football Platform - IIS Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectPath = $PSScriptRoot
$siteName = "FootballPlatform"
$appPoolName = "FootballPlatformAppPool"
$port = 8080

# Check if running as Administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click the script and select 'Run with PowerShell' or 'Run as Administrator'" -ForegroundColor Yellow
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Function to check if a command exists
function Test-Command {
    param($command)
    $null -ne (Get-Command $command -ErrorAction SilentlyContinue)
}

Write-Host "Step 1: Checking prerequisites..." -ForegroundColor Yellow
Write-Host ""

# Check Node.js
if (Test-Command "node") {
    $nodeVersion = node --version
    Write-Host "✓ Node.js is installed: $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "✗ Node.js is NOT installed!" -ForegroundColor Red
    Write-Host "  Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check IIS
if (Test-Path "C:\Windows\System32\inetsrv\inetmgr.exe") {
    Write-Host "✓ IIS is installed" -ForegroundColor Green
} else {
    Write-Host "✗ IIS is NOT installed!" -ForegroundColor Red
    Write-Host "  Please install IIS from Windows Features" -ForegroundColor Yellow
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check iisnode
$iisnodePath = "${env:ProgramFiles}\iisnode\iisnode.dll"
if (Test-Path $iisnodePath) {
    Write-Host "✓ iisnode is installed" -ForegroundColor Green
} else {
    Write-Host "✗ iisnode is NOT installed!" -ForegroundColor Red
    Write-Host "  Please download and install from:" -ForegroundColor Yellow
    Write-Host "  https://github.com/Azure/iisnode/releases" -ForegroundColor Yellow
    Write-Host "  Download: iisnode-full-v0.2.26-x64.msi (for 64-bit Windows)" -ForegroundColor Yellow
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

# Check URL Rewrite
$rewritePath = "${env:ProgramFiles}\IIS\Microsoft Web Platform Installer\feeds\rewrite2.xml"
$rewriteInstalled = (Get-WindowsFeature -Name Web-Url-Rewrite -ErrorAction SilentlyContinue) -or (Test-Path "C:\Program Files\IIS\URL Rewrite\*")
if ($rewriteInstalled) {
    Write-Host "✓ URL Rewrite Module is installed" -ForegroundColor Green
} else {
    Write-Host "⚠ URL Rewrite Module may not be installed" -ForegroundColor Yellow
    Write-Host "  If you encounter issues, download from:" -ForegroundColor Yellow
    Write-Host "  https://www.iis.net/downloads/microsoft/url-rewrite" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Step 2: Installing npm dependencies..." -ForegroundColor Yellow
Write-Host ""

try {
    Set-Location $projectPath
    if (Test-Path "package.json") {
        npm install
        Write-Host "✓ Dependencies installed successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ package.json not found!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to install dependencies: $_" -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Step 3: Setting folder permissions..." -ForegroundColor Yellow
Write-Host ""

try {
    # Add IIS_IUSRS permissions
    $acl = Get-Acl $projectPath
    $permission = "IIS_IUSRS","ReadAndExecute","ContainerInherit,ObjectInherit","None","Allow"
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
    $acl.SetAccessRule($accessRule)
    Set-Acl $projectPath $acl
    Write-Host "✓ Added IIS_IUSRS permissions" -ForegroundColor Green

    # Add IUSR permissions
    $acl = Get-Acl $projectPath
    $permission = "IUSR","ReadAndExecute","ContainerInherit,ObjectInherit","None","Allow"
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
    $acl.SetAccessRule($accessRule)
    Set-Acl $projectPath $acl
    Write-Host "✓ Added IUSR permissions" -ForegroundColor Green

    # Create uploads directory if it doesn't exist
    $uploadsPath = Join-Path $projectPath "uploads"
    if (-not (Test-Path $uploadsPath)) {
        New-Item -ItemType Directory -Path $uploadsPath | Out-Null
        Write-Host "✓ Created uploads directory" -ForegroundColor Green
    }

    # Add write permissions to uploads folder
    $acl = Get-Acl $uploadsPath
    $permission = "IIS_IUSRS","Modify","ContainerInherit,ObjectInherit","None","Allow"
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
    $acl.SetAccessRule($accessRule)
    Set-Acl $uploadsPath $acl
    Write-Host "✓ Added write permissions to uploads folder" -ForegroundColor Green

} catch {
    Write-Host "✗ Failed to set permissions: $_" -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Step 4: Configuring IIS..." -ForegroundColor Yellow
Write-Host ""

try {
    Import-Module WebAdministration

    # Remove existing site if it exists
    if (Test-Path "IIS:\Sites\$siteName") {
        Write-Host "  Removing existing site..." -ForegroundColor Gray
        Remove-WebSite -Name $siteName
    }

    # Remove existing app pool if it exists
    if (Test-Path "IIS:\AppPools\$appPoolName") {
        Write-Host "  Removing existing app pool..." -ForegroundColor Gray
        Remove-WebAppPool -Name $appPoolName
    }

    # Create application pool
    Write-Host "  Creating application pool..." -ForegroundColor Gray
    New-WebAppPool -Name $appPoolName | Out-Null
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name "managedRuntimeVersion" -Value ""
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name "enable32BitAppOnWin64" -Value $false
    Write-Host "✓ Application pool created" -ForegroundColor Green

    # Create website
    Write-Host "  Creating website..." -ForegroundColor Gray
    New-WebSite -Name $siteName -Port $port -PhysicalPath $projectPath -ApplicationPool $appPoolName -Force | Out-Null
    Write-Host "✓ Website created" -ForegroundColor Green

    # Start the website
    Start-WebSite -Name $siteName
    Write-Host "✓ Website started" -ForegroundColor Green

} catch {
    Write-Host "✗ Failed to configure IIS: $_" -ForegroundColor Red
    Read-Host -Prompt "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Step 5: Verifying web.config..." -ForegroundColor Yellow
Write-Host ""

$webConfigPath = Join-Path $projectPath "web.config"
if (Test-Path $webConfigPath) {
    Write-Host "✓ web.config exists" -ForegroundColor Green
} else {
    Write-Host "✗ web.config not found!" -ForegroundColor Red
    Write-Host "  The web.config file should have been created automatically." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your Football Platform is now running on IIS!" -ForegroundColor Green
Write-Host ""
Write-Host "Access your site at:" -ForegroundColor Cyan
Write-Host "  http://localhost:$port" -ForegroundColor White
Write-Host ""
Write-Host "Site Details:" -ForegroundColor Cyan
Write-Host "  Site Name: $siteName" -ForegroundColor White
Write-Host "  Physical Path: $projectPath" -ForegroundColor White
Write-Host "  Port: $port" -ForegroundColor White
Write-Host "  App Pool: $appPoolName" -ForegroundColor White
Write-Host ""
Write-Host "Default Login Credentials:" -ForegroundColor Cyan
Write-Host "  Agent Email: agent@example.com" -ForegroundColor White
Write-Host "  Agent Password: agent123" -ForegroundColor White
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  Restart IIS: iisreset" -ForegroundColor White
Write-Host "  View IIS Manager: inetmgr" -ForegroundColor White
Write-Host "  Check logs: $projectPath\iisnode\" -ForegroundColor White
Write-Host ""
Write-Host "If you need to change the port, edit the binding in IIS Manager." -ForegroundColor Yellow
Write-Host ""

# Try to open the browser
$openBrowser = Read-Host "Would you like to open the site in your browser now? (Y/N)"
if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
    Start-Process "http://localhost:$port"
}

Write-Host ""
Write-Host "Press Enter to exit..." -ForegroundColor Gray
Read-Host
