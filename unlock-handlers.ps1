# Unlock IIS handlers section
# Run as Administrator

Write-Host "Unlocking IIS handlers section..." -ForegroundColor Yellow
Write-Host ""

try {
    # Unlock handlers section
    & "$env:windir\system32\inetsrv\appcmd.exe" unlock config -section:system.webServer/handlers
    Write-Host "✓ Handlers section unlocked successfully!" -ForegroundColor Green
    
    # Also unlock modules section (sometimes needed)
    & "$env:windir\system32\inetsrv\appcmd.exe" unlock config -section:system.webServer/modules
    Write-Host "✓ Modules section unlocked successfully!" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "Now restart IIS..." -ForegroundColor Yellow
    iisreset
    
    Write-Host ""
    Write-Host "✓ IIS restarted successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now:" -ForegroundColor Cyan
    Write-Host "1. Open IIS Manager" -ForegroundColor White
    Write-Host "2. Click on your FootballPlatform site" -ForegroundColor White
    Write-Host "3. Double-click Handler Mappings (should work now)" -ForegroundColor White
    Write-Host "4. Try accessing http://localhost:8088" -ForegroundColor White
    Write-Host ""
    
} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "You may need to run this as Administrator" -ForegroundColor Yellow
}

Read-Host "Press Enter to exit"
