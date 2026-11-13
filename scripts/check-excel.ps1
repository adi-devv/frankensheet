# Opens each .xlsx in real Excel (hidden) and reports whether Excel had to repair it.
# Excel writes a repair log (error*.xml) to %TEMP% whenever it repairs a file; we watch for new ones.
# Usage: powershell -File scripts/check-excel.ps1 fixtures/out/spike
param([Parameter(Mandatory = $true)][string]$Dir)

$files = Get-ChildItem -Path $Dir -Filter *.xlsx -Recurse | Sort-Object FullName
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$fail = 0
try {
  foreach ($f in $files) {
    $before = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
    $status = 'OK'
    try {
      $wb = $xl.Workbooks.Open($f.FullName, 0, $true)
      $after = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
      $new = $after | Where-Object { $before -notcontains $_ }
      if ($new) { $status = 'REPAIRED (' + (Split-Path $new[0] -Leaf) + ')' }
      $wb.Close($false)
    } catch {
      $status = 'FAILED: ' + $_.Exception.Message
    }
    if ($status -ne 'OK') { $fail++ }
    '{0,-45} {1}' -f $f.Name, $status
  }
} finally {
  $xl.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
"$($files.Count) files, $fail not clean"
exit $fail
