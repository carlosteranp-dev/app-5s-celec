# Publica la app en GitHub Pages en un solo paso.
#
#   Doble clic en publicar.bat (en la raíz del proyecto), o:
#   powershell -ExecutionPolicy Bypass -File tools\publicar.ps1
#
# Qué hace: sella el service worker, corre las pruebas, guarda los cambios en git, conecta con GitHub
# (si hace falta), sube el código y activa GitHub Pages. Antes de subir NADA pide confirmación escrita.
#
# Parámetros:
#   -Repositorio <url>   Dirección del repositorio vacío de GitHub (si no se indica y no hay remoto, se pregunta).
#   -SoloVerificar       Sella y corre las pruebas, sin guardar cambios ni subir nada.

param(
    [string]$Repositorio = "",
    [switch]$SoloVerificar
)

# En Windows PowerShell 5.1, "Stop" convierte en error el texto que git escribe en stderr (su progreso normal);
# por eso se usa "Continue" y se revisa el código de salida de cada comando.
$ErrorActionPreference = "Continue"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Paso($texto) { Write-Host ""; Write-Host "== $texto" -ForegroundColor Cyan }
function Aviso($texto) { Write-Host $texto -ForegroundColor Yellow }
function Fallar($texto) { Write-Host ""; Write-Host "ERROR: $texto" -ForegroundColor Red; exit 1 }
function Existe($comando) { return [bool](Get-Command $comando -ErrorAction SilentlyContinue) }

# Ejecuta un comando externo y se detiene si termina con error.
function Ejecutar([scriptblock]$comando, [string]$errorTexto) {
    & $comando
    if ($LASTEXITCODE -ne 0) { Fallar $errorTexto }
}

# --- 1. Herramientas --------------------------------------------------------------
Paso "1. Revisando que estén instaladas las herramientas"
if (-not (Existe "node")) { Fallar "No se encontró Node.js. Instálelo desde https://nodejs.org y vuelva a ejecutar." }
if (-not (Existe "git")) { Fallar "No se encontró Git. Instálelo desde https://git-scm.com y vuelva a ejecutar." }
if (-not (Test-Path ".git")) { Fallar "Esta carpeta no es un repositorio de git. Ejecute el script desde la carpeta del proyecto." }
Write-Host "Node $(node --version) y $(git --version)" -ForegroundColor Green

# --- 2. Sellar y probar -----------------------------------------------------------
Paso "2. Sellando el service worker (versión de la caché)"
Ejecutar { node tools/sellar.mjs } "No se pudo sellar el service worker."

Paso "3. Corriendo las pruebas"
Ejecutar { npm test } "Las pruebas fallaron. Corrija el problema antes de publicar (revise el mensaje de arriba)."
Write-Host "Todas las pruebas pasaron." -ForegroundColor Green

if ($SoloVerificar) {
    Paso "Modo verificación"
    $cambios = (git status --porcelain | Measure-Object).Count
    Write-Host "Archivos con cambios sin guardar: $cambios"
    Write-Host "Verificación terminada. No se guardó ni se subió nada." -ForegroundColor Green
    exit 0
}

# --- 3. Guardar cambios -----------------------------------------------------------
Paso "4. Guardando los cambios en git"
$pendientes = git status --porcelain
if ($pendientes) {
    Write-Host $pendientes
    Ejecutar { git add -A } "No se pudieron preparar los cambios."
    $mensaje = "Actualización " + (Get-Date -Format "yyyy-MM-dd HH:mm")
    Ejecutar { git commit -q -m $mensaje } "No se pudo guardar el commit."
    Write-Host "Cambios guardados: $mensaje" -ForegroundColor Green
} else {
    Write-Host "No hay cambios nuevos que guardar."
}

# --- 4. Conectar con GitHub ---------------------------------------------------------
Paso "5. Conectando con GitHub"
$origen = (git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0) { $origen = "" }

if (-not $origen) {
    if (-not $Repositorio) {
        Write-Host "Aún no hay un repositorio de GitHub conectado."
        Write-Host "1) Entre a https://github.com/new, ponga un nombre (por ejemplo app-5s-celec),"
        Write-Host "   marque 'Public' y deje SIN marcar README, .gitignore y licencia. Pulse 'Create repository'."
        Write-Host "2) Copie la dirección que termina en .git (https://github.com/<usuario>/<repositorio>.git)."
        $Repositorio = (Read-Host "Pegue aquí la dirección del repositorio").Trim()
    }
    if ($Repositorio -notmatch '^https://github\.com/[\w.-]+/[\w.-]+?(\.git)?/?$') {
        Fallar "La dirección no parece de GitHub. Debe ser como https://github.com/<usuario>/<repositorio>.git"
    }
    Ejecutar { git remote add origin $Repositorio } "No se pudo conectar el repositorio."
    $origen = $Repositorio
}
Write-Host "Repositorio: $origen" -ForegroundColor Green

# --- 5. Subir (con confirmación) ---------------------------------------------------
Paso "6. Subir el código a GitHub"
Aviso "Se subirá TODO el contenido del proyecto a: $origen"
Aviso "Si el repositorio es público, el código y el instrumento_5S.json serán visibles para cualquiera."
Aviso "Las evaluaciones, fotos y firmas NO se suben (viven solo en los teléfonos y en los respaldos)."
$respuesta = Read-Host "Escriba SI para subir, o pulse Enter para cancelar"
if ($respuesta.Trim().ToUpper() -ne "SI") {
    Write-Host "Cancelado. No se subió nada." -ForegroundColor Yellow
    exit 0
}
$rama = (git branch --show-current).Trim()
Ejecutar { git push -u origin $rama } "No se pudo subir. Si pide iniciar sesión, autorícela en el navegador y vuelva a ejecutar."
Write-Host "Código subido." -ForegroundColor Green

# --- 6. GitHub Pages ---------------------------------------------------------------
Paso "7. Activando GitHub Pages"
if ($origen -notmatch 'github\.com[:/]([\w.-]+)/([\w.-]+?)(\.git)?/?$') { Fallar "No se pudo leer el usuario y el repositorio de $origen" }
$usuario = $Matches[1]
$nombre = $Matches[2]
$url = "https://$usuario.github.io/$nombre/"

$activado = $false
if ((Existe "gh") -and ((gh auth status 2>&1 | Out-String) -match "Logged in")) {
    gh api -X POST "repos/$usuario/$nombre/pages" -f "source[branch]=$rama" -f "source[path]=/" 2>&1 | Out-Null
    # Código 0: se activó ahora. Si ya estaba activo, GitHub responde con error y no hace falta hacer nada.
    $activado = $true
    Write-Host "GitHub Pages activado (o ya estaba activo)." -ForegroundColor Green
}
if (-not $activado) {
    Aviso "Falta un paso manual (una sola vez):"
    Write-Host "  1) Abra https://github.com/$usuario/$nombre/settings/pages"
    Write-Host "  2) En 'Build and deployment' elija 'Deploy from a branch'."
    Write-Host "  3) Rama: $rama   Carpeta: / (root)   y pulse 'Save'."
}

Write-Host ""
Write-Host "Listo. En 1 o 2 minutos la app estará en:" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor White
Write-Host "Ábrala en cada celular, con internet, e instálela (ver README, sección 'Instalar y usar sin conexión')."
