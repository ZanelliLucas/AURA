; Ajout/retrait de $INSTDIR au PATH utilisateur (HKCU\Environment), en NSIS
; pur (aucun plugin externe type EnVar, non fourni avec le NSIS embarque
; par electron-builder). Permet a `aura` d'etre reconnu depuis n'importe
; quel terminal une fois l'app installee (F-12), sans code source ni
; Node.js sur la machine cible.
;
; Installe aussi un lanceur PowerShell personnel "launched AURA" (meme
; principe F-12/F-22 : rien de visible - pas de raccourci - tant que
; cette commande n'a pas ete tapee dans un terminal). La fonction elle-
; meme vit dans $INSTDIR\launched-profile.ps1 (supprimee automatiquement
; a la desinstallation, puisque tout $INSTDIR l'est) ; le profil
; PowerShell de l'utilisateur ne recoit qu'une seule ligne d'inclusion
; (dot-source), facile a ajouter sans doublon et a retirer proprement.

!include "LogicLib.nsh"

!macro customInstall
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} $R0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  ${Else}
    Push $R0
    Push "$INSTDIR"
    Call StrStr
    Pop $R1
    ${If} $R1 == ""
      WriteRegExpandStr HKCU "Environment" "Path" "$R0;$INSTDIR"
    ${EndIf}
  ${EndIf}
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000

  ; --- Lanceur "launched AURA" -----------------------------------------
  ; launched-profile.ps1 est deja present dans $INSTDIR a ce stade : copie
  ; par electron-builder via build.extraFiles (package.json), pas par ce
  ; script NSIS (${__FILEDIR__} pointe vers le dossier de template interne
  ; d'electron-builder au moment de la compilation, pas vers app/ - une
  ; resolution manuelle ici serait fragile).

  CreateDirectory "$DOCUMENTS\WindowsPowerShell"
  StrCpy $1 "$DOCUMENTS\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
  StrCpy $2 '. "$INSTDIR\launched-profile.ps1"'

  ; N'ajoute la ligne d'inclusion que si elle n'y est pas deja (evite les
  ; doublons en cas de reinstallation/mise a jour).
  ClearErrors
  FileOpen $3 "$1" r
  ${If} ${Errors}
    FileOpen $3 "$1" w
    FileWrite $3 "$2$\r$\n"
    FileClose $3
  ${Else}
    StrCpy $4 "0"
    loopReadProfileInstall:
      FileRead $3 $5
      IfErrors doneReadProfileInstall
      StrCmp $5 "$2$\r$\n" foundLineInstall
      StrCmp $5 "$2$\n" foundLineInstall
      Goto loopReadProfileInstall
      foundLineInstall:
        StrCpy $4 "1"
      Goto loopReadProfileInstall
    doneReadProfileInstall:
    FileClose $3
    ${If} $4 == "0"
      FileOpen $3 "$1" a
      FileSeek $3 0 END
      FileWrite $3 "$2$\r$\n"
      FileClose $3
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ReadRegStr $R0 HKCU "Environment" "Path"
  ${If} $R0 != ""
    Push $R0
    Push "$INSTDIR"
    Call un.StrStr
    Pop $R1
    ${If} $R1 != ""
      StrLen $R2 $R1
      StrLen $R3 $R0
      IntOp $R4 $R3 - $R2
      StrCpy $R5 $R0 $R4
      StrLen $R6 "$INSTDIR"
      StrCpy $R7 $R1 "" $R6
      StrCpy $R8 $R7 1
      ${If} $R8 == ";"
        StrCpy $R7 $R7 "" 1
      ${Else}
        StrCpy $R9 $R5 1 -1
        ${If} $R9 == ";"
          StrCpy $R5 $R5 -1
        ${EndIf}
      ${EndIf}
      StrCpy $R0 "$R5$R7"
      WriteRegExpandStr HKCU "Environment" "Path" $R0
    ${EndIf}
  ${EndIf}
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000

  ; --- Retrait de la ligne d'inclusion du lanceur "launched AURA" ------
  ; launched-profile.ps1 disparait de lui-meme avec $INSTDIR : seule la
  ; ligne d'inclusion, ajoutee dans le profil de l'utilisateur, doit
  ; etre retiree explicitement ici.
  StrCpy $0 "$DOCUMENTS\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"
  StrCpy $1 '. "$INSTDIR\launched-profile.ps1"'
  ClearErrors
  FileOpen $2 "$0" r
  ${IfNot} ${Errors}
    FileOpen $3 "$0.aura-tmp" w
    loopUninstallProfile:
      FileRead $2 $4
      IfErrors doneUninstallProfile
      StrCmp $4 "$1$\r$\n" skipLineUn
      StrCmp $4 "$1$\n" skipLineUn
      FileWrite $3 "$4"
      Goto loopUninstallProfile
      skipLineUn:
      Goto loopUninstallProfile
    doneUninstallProfile:
    FileClose $2
    FileClose $3
    Delete "$0"
    Rename "$0.aura-tmp" "$0"
  ${EndIf}
!macroend

; StrStr classique (domaine public, wiki NSIS) : renvoie la sous-chaine de
; $R2 (haystack) a partir de la premiere occurrence de $R1 (needle), ou ""
; si absente. electron-builder compile ce script en deux passes (installeur
; / desinstalleur, selon BUILD_UNINSTALLER) : chaque variante doit rester
; conditionnee a sa passe, sinon NSIS la trouve "non referencee" et abandonne
; (l'appel correspondant, dans customInstall/customUnInstall, est lui-meme
; conditionne a la meme passe par les templates electron-builder).
!ifndef BUILD_UNINSTALLER
Function StrStr
  Exch $R1
  Exch
  Exch $R2
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
  loop:
    StrCpy $R5 $R2 $R3 $R4
    StrCmp $R5 $R1 done
    StrCmp $R5 "" done
    IntOp $R4 $R4 + 1
    Goto loop
  done:
    StrCpy $R1 $R2 "" $R4
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Exch $R1
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
Function un.StrStr
  Exch $R1
  Exch
  Exch $R2
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
  loop:
    StrCpy $R5 $R2 $R3 $R4
    StrCmp $R5 $R1 done
    StrCmp $R5 "" done
    IntOp $R4 $R4 + 1
    Goto loop
  done:
    StrCpy $R1 $R2 "" $R4
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Exch $R1
FunctionEnd
!endif
