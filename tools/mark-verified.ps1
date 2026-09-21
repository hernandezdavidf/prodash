# Records that index.html and cloud-worker/worker.js were loaded in a real
# browser and parsed without error.
#
# WHY THIS EXISTS: nothing on this machine can parse this code. No Node, no
# Deno, no Bun; Windows' JScript host is ES5 and the app uses const and
# template literals; headless Chrome and Edge are installed but produce no
# output when spawned from here. The browser is the only parser available, and
# a person or an agent has to drive it.
#
# So the gate does not pretend to parse. It records a hash of what was last
# verified, and validate.ps1 fails while the files have moved on. That turns
# "I should check it in a browser" into a step that cannot be skipped quietly.
#
# ONLY run this after actually loading the page and seeing it work. Running it
# to silence the warning is forging a test result - it defeats the single
# check standing between a syntax error and a board that will not open.

$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root ".tmp"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$out = [ordered]@{}
foreach ($rel in @("index.html", "cloud-worker/worker.js")) {
  $p = Join-Path $root $rel
  if (Test-Path $p) { $out[$rel] = (Get-FileHash -Path $p -Algorithm SHA256).Hash }
}
$out["verifiedAt"] = (Get-Date).ToString("o")

$dest = Join-Path $tmp "verified.json"
($out | ConvertTo-Json) | Set-Content -Path $dest -Encoding utf8
Write-Output "Recorded browser verification for $($out.Keys.Count - 1) file(s) in .tmp/verified.json"
