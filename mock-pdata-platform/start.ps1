# PDATA Mock Platform - PowerShell Launcher (with auto port selection)
$ErrorActionPreference = "Stop"

# Change to script directory
Set-Location $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PDATA Mock Platform - Demo" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a port is available
function Test-PortAvailable {
    param([int]$Port)
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$Port/")
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

# Find an available port (start from 8080, try up to 8099)
$port = 8080
$maxPort = 8099
$portFound = $false

while ($port -le $maxPort) {
    if (Test-PortAvailable $port) {
        $portFound = $true
        break
    }
    Write-Host "Port $port is in use, trying next..." -ForegroundColor Yellow
    $port++
}

if (-not $portFound) {
    Write-Host "Error: No available port found (8080-8099)." -ForegroundColor Red
    Write-Host "Please close some applications and try again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Using port: $port" -ForegroundColor Green
Write-Host ""

# Find Chrome
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chromeExe = $null
foreach ($path in $chromePaths) {
    if (Test-Path $path) {
        $chromeExe = $path
        break
    }
}

# Start HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

$url = "http://localhost:$port"
Write-Host "Server started successfully!" -ForegroundColor Green
Write-Host "URL: $url" -ForegroundColor Green
Write-Host ""

# Open browser
if ($chromeExe) {
    Start-Process $chromeExe $url
} else {
    Start-Process $url
}

Write-Host "Browser opened. Close this window to stop the server." -ForegroundColor Yellow
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host "Server running... (press Ctrl+C to stop)" -ForegroundColor DarkGray
Write-Host "----------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# Handle requests
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        $urlPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($urlPath)) {
            $urlPath = "index.html"
        }
        
        $filePath = Join-Path $PSScriptRoot $urlPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $content.Length
            
            # Set content type
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            switch ($ext) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".css"  { $response.ContentType = "text/css; charset=utf-8" }
                ".js"   { $response.ContentType = "application/javascript; charset=utf-8" }
                ".json" { $response.ContentType = "application/json; charset=utf-8" }
                ".png"  { $response.ContentType = "image/png" }
                ".jpg"  { $response.ContentType = "image/jpeg" }
                ".jpeg" { $response.ContentType = "image/jpeg" }
                ".gif"  { $response.ContentType = "image/gif" }
                ".svg"  { $response.ContentType = "image/svg+xml" }
                ".ico"  { $response.ContentType = "image/x-icon" }
                ".woff" { $response.ContentType = "font/woff" }
                ".woff2" { $response.ContentType = "font/woff2" }
                ".ttf"  { $response.ContentType = "font/ttf" }
                ".mp4"  { $response.ContentType = "video/mp4" }
                ".webm" { $response.ContentType = "video/webm" }
                default { $response.ContentType = "application/octet-stream" }
            }
            
            $response.OutputStream.Write($content, 0, $content.Length)
        } else {
            $response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        }
        
        $response.Close()
    } catch {
        # Ignore errors
    }
}
