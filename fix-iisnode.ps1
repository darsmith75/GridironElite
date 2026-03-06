# Fix iisnode configuration
# Run as Administrator

Write-Host "Fixing iisnode configuration..." -ForegroundColor Yellow

$siteName = "FootballPlatform"
$projectPath = "C:\KiroProjects"

# Check if iisnode is installed
$iisnodePath = "${env:ProgramFiles}\iisnode\iisnode.dll"
if (-not (Test-Path $iisnodePath)) {
    Write-Host "ERROR: iisnode is not installed!" -ForegroundColor Red
    Write-Host "Please download and install from:" -ForegroundColor Yellow
    Write-Host "https://github.com/Azure/iisnode/releases/download/v0.2.26/iisnode-full-v0.2.26-x64.msi" -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "iisnode found at: $iisnodePath" -ForegroundColor Green

# Import WebAdministration module
Import-Module WebAdministration

# Check if site exists
if (-not (Test-Path "IIS:\Sites\$siteName")) {
    Write-Host "ERROR: Site '$siteName' does not exist!" -ForegroundColor Red
    Write-Host "Please create the site first in IIS Manager" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Site found: $siteName" -ForegroundColor Green

# Ensure web.config exists
$webConfigPath = Join-Path $projectPath "web.config"
if (-not (Test-Path $webConfigPath)) {
    Write-Host "ERROR: web.config not found at $webConfigPath" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "web.config found" -ForegroundColor Green

# Create iisnode folder manually
$iisnodeLogPath = Join-Path $projectPath "iisnode"
if (-not (Test-Path $iisnodeLogPath)) {
    New-Item -ItemType Directory -Path $iisnodeLogPath | Out-Null
    Write-Host "Created iisnode log directory" -ForegroundColor Green
}

# Set permissions on iisnode folder
$acl = Get-Acl $iisnodeLogPath
$permission = "IIS_IUSRS","Modify","ContainerInherit,ObjectInherit","None","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$acl.SetAccessRule($accessRule)
Set-Acl $iisnodeLogPath $acl
Write-Host "Set permissions on iisnode folder" -ForegroundColor Green

# Restart the site
Write-Host "Restarting site..." -ForegroundColor Yellow
Stop-WebSite -Name $siteName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-WebSite -Name $siteName

Write-Host ""
Write-Host "Configuration updated!" -ForegroundColor Green
Write-Host ""
Write-Host "Now try accessing: http://localhost:8088" -ForegroundColor Cyan
Write-Host ""
Write-Host "If it still doesn't work, check:" -ForegroundColor Yellow
Write-Host "1. IIS Manager > Sites > FootballPlatform > Handler Mappings" -ForegroundColor White
Write-Host "   - Should see 'iisnode' handler for *.js files" -ForegroundColor White
Write-Host "2. IIS Manager > Server > Modules" -ForegroundColor White
Write-Host "   - Should see 'iisnode' module" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"
