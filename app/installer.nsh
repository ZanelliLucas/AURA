; Ajout/retrait de $INSTDIR au PATH utilisateur (HKCU\Environment), en NSIS
; pur (aucun plugin externe type EnVar, non fourni avec le NSIS embarque
; par electron-builder). Permet a `aura` d'etre reconnu depuis n'importe
; quel terminal une fois l'app installee (F-12), sans code source ni
; Node.js sur la machine cible.

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
