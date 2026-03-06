# Run this script as Administrator
# Right-click and select "Run with PowerShell"

Write-Host "Setting up IIS permissions for Football Platform..." -ForegroundColor Green

$projectPath = "C:\KiroProjects"

# Add IIS_IUSRS permissions
Write-Host "Adding IIS_IUSRS permissions..." -ForegroundColor Yellow
$acl = Get-Acl $projectPath
$permission = "IIS_IUSRS","ReadAndExecute","ContainerInherit,ObjectInherit","None","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$acl.SetAccessRule($accessRule)
Set-Acl $projectPath $acl

# Add IUSR permissions (for anonymous access)
Write-Host "Adding IUSR permissions..." -ForegroundColor Yellow
$acl = Get-Acl $projectPath
$permission = "IUSR","ReadAndExecute","ContainerInherit,ObjectInherit","None","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$acl.SetAccessRule($accessRule)
Set-Acl $projectPath $acl

# Create uploads directory if it doesn't exist and set write permissions
$uploadsPath = Join-Path $projectPath "uploads"
if (-not (Test-Path $uploadsPath)) {
    New-Item -ItemType Directory -Path $uploadsPath | Out-Null
}

Write-Host "Adding write permissions to uploads folder..." -ForegroundColor Yellow
$acl = Get-Acl $uploadsPath
$permission = "IIS_IUSRS","Modify","ContainerInherit,ObjectInherit","None","Allow"
$accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule $permission
$acl.SetAccessRule($accessRule)
Set-Acl $uploadsPath $acl

Write-Host "`nPermissions set successfully!" -ForegroundColor Green
Write-Host "You can now create the IIS website." -ForegroundColor Cyan

# Pause so user can see the results
Read-Host -Prompt "Press Enter to continue"
