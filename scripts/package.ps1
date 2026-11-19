[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json
$config = $manifest.'smc-ssl-certificate-manager'
if (-not $config) { throw 'Missing smc-ssl-certificate-manager packaging configuration in package.json.' }

function Expand-Template([string]$value) {
    $value.Replace('${name}', [string]$manifest.name).Replace('${version}', [string]$manifest.version)
}

function Get-RelativePath([string]$path) {
    $rootUri = [Uri]::new(([IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'))
    $pathUri = [Uri]::new([IO.Path]::GetFullPath($path))
    [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace('\', '/')
}

$files = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($include in $config.include) {
    $include = [string]$include
    if ($include.EndsWith('/**')) {
        $directory = Join-Path $appRoot $include.Substring(0, $include.Length - 3)
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Included directory was not found: $include" }
        Get-ChildItem -LiteralPath $directory -Recurse -File | ForEach-Object { [void]$files.Add($_.FullName) }
    } else {
        $file = Join-Path $appRoot $include
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Included file was not found: $include" }
        [void]$files.Add((Resolve-Path -LiteralPath $file).Path)
    }
}

$packagePath = [IO.Path]::GetFullPath((Join-Path $appRoot (Expand-Template ([string]$config.packageName))))
$stagePath = Join-Path ([IO.Path]::GetTempPath()) ("smc-certificate-manager-" + [Guid]::NewGuid().ToString('N'))
$terserPath = Join-Path $appRoot 'node_modules/.bin/terser.cmd'
if ($config.minify -eq $true -and -not (Test-Path -LiteralPath $terserPath -PathType Leaf)) {
    throw 'JavaScript minification is enabled but Terser is unavailable. Run npm install first.'
}

try {
    foreach ($file in $files) {
        $relativePath = Get-RelativePath $file
        $stagedFile = Join-Path $stagePath $relativePath
        [IO.Directory]::CreateDirectory((Split-Path -Parent $stagedFile)) | Out-Null
        Copy-Item -LiteralPath $file -Destination $stagedFile
        if ($config.minify -eq $true -and $relativePath -like 'assets/js/*.js') {
            $minifiedFile = "$stagedFile.min"
            & $terserPath $stagedFile --module --compress --mangle --output $minifiedFile
            if ($LASTEXITCODE -ne 0) { throw "Could not minify $relativePath" }
            Move-Item -LiteralPath $minifiedFile -Destination $stagedFile -Force
        }
    }

    [IO.Directory]::CreateDirectory((Split-Path -Parent $packagePath)) | Out-Null
    if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath -Force }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($packagePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files | Sort-Object) {
            $relativePath = Get-RelativePath $file
            $stagedFile = Join-Path $stagePath $relativePath
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $stagedFile, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
} finally {
    if (Test-Path -LiteralPath $stagePath) { Remove-Item -LiteralPath $stagePath -Recurse -Force }
}

Write-Host "Created $packagePath"
