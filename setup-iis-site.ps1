# Run this script as Administrator
# Right-click and select "Run with PowerShell"

Write-Host "Setting up IIS website for Football Platform..." -ForegroundColor Green

Import-Module WebAdministration

$siteName = "FootballPlatform"
$projectPath = "C:\GridironElite"
$port = 8080

# Check if site already exists
if (Test-Path "IIS:\Sites\$siteName") {
    Write-Host "Site '$siteName' already exists. Removing it..." -ForegroundColor Yellow
    Remove-WebSite -Name $siteName
}

# Create new website
Write-Host "Creating IIS website..." -ForegroundColor Yellow
New-WebSite -Name $siteName -Port $port -PhysicalPath $projectPath -Force

# Create application pool if it doesn't exist
$appPoolName = "FootballPlatformAppPool"
if (-not (Test-Path "IIS:\AppPools\$appPoolName")) {
    Write-Host "Creating application pool..." -ForegroundColor Yellow
    New-WebAppPool -Name $appPoolName
    Set-ItemProperty "IIS:\AppPools\$appPoolName" -Name "managedRuntimeVersion" -Value ""
}

# Assign app pool to website
Set-ItemProperty "IIS:\Sites\$siteName" -Name "applicationPool" -Value $appPoolName

Write-Host "`nWebsite created successfully!" -ForegroundColor Green
Write-Host "Site Name: $siteName" -ForegroundColor Cyan
Write-Host "URL: http://localhost:$port" -ForegroundColor Cyan
Write-Host "Physical Path: $projectPath" -ForegroundColor Cyan

# Start the website
Write-Host "`nStarting website..." -ForegroundColor Yellow
Start-WebSite -Name $siteName

Write-Host "`nSetup complete! You can now access your site at http://localhost:$port" -ForegroundColor Green

# Pause so user can see the results
Read-Host -Prompt "Press Enter to continue"
