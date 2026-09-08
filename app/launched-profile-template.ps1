# AURA - lanceur personnel (F-12/F-22), copie telle quelle par
# l'installateur dans le dossier d'installation ($INSTDIR). Se localise
# lui-meme via $PSScriptRoot : aucune substitution necessaire cote NSIS.
#
# Delegue a aura-launcher.exe (compile a la construction du paquet,
# scripts/fix-exe-subsystem.js + aura-launcher-src/AuraLauncher.cs)
# plutot que de compiler du C# a chaud a chaque invocation (Add-Type) :
# plus rapide et deterministe - une compilation Add-Type a chaud avait
# une duree variable (antivirus scannant l'assembly fraichement compile
# en memoire), parfois assez longue pour que l'appel a exit ci-dessous
# intervienne avant que Windows Terminal n'ait fini de s'attacher a la
# session, laissant l'onglet ouvert.
function launched {
    param([string]$App)
    if ($App -ieq 'AURA') {
        Start-Process -FilePath (Join-Path $PSScriptRoot "aura-launcher.exe")
        exit
    } else {
        Write-Host "Usage : launched AURA"
    }
}
