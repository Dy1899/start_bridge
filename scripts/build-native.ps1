$ErrorActionPreference='Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw '需要 Windows .NET Framework 4.x 编译器。' }
& $compilerPath /nologo /target:exe /platform:x64 /optimize+ /codepage:65001 /reference:System.Web.Extensions.dll ("/out:" + (Join-Path $projectRoot 'native\InputAgent.exe')) (Join-Path $projectRoot 'native\InputAgent.cs')
if ($LASTEXITCODE -ne 0) { throw 'InputAgent 编译失败' }
