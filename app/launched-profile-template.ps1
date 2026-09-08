# AURA - lanceur personnel (F-12/F-22), copie telle quelle par
# l'installateur dans le dossier d'installation ($INSTDIR). Se localise
# lui-meme via $PSScriptRoot : aucune substitution necessaire cote NSIS.
#
# Utilise CreateProcess avec l'indicateur Windows DETACHED_PROCESS,
# non expose par System.Diagnostics.Process/Start-Process. Sans lui,
# Windows peut rattacher la console d'AURA au terminal appelant (la
# fonctionnalite "application de terminal par defaut" de Windows 11
# recupere la console d'un processus console-subsystem meme lance via
# ShellExecute) : le terminal semble se figer au lieu de se fermer, et
# la sortie console d'AURA s'y affiche. DETACHED_PROCESS empeche toute
# allocation/heritage de console des le depart - comportement identique
# a `spawn(..., {detached:true, stdio:'ignore'})` en Node.js, deja
# valide dans le lanceur de developpement (bin/aura.js).
if (-not ("AuraLauncher" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class AuraLauncher {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO {
        public Int32 cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public Int32 dwX; public Int32 dwY; public Int32 dwXSize; public Int32 dwYSize;
        public Int32 dwXCountChars; public Int32 dwYCountChars; public Int32 dwFillAttribute;
        public Int32 dwFlags; public Int16 wShowWindow; public Int16 cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId;
    }

    public const uint DETACHED_PROCESS = 0x00000008;
    public const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;

    public static void Launch(string exePath) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        PROCESS_INFORMATION pi;
        CreateProcess(exePath, null, IntPtr.Zero, IntPtr.Zero, false, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, IntPtr.Zero, null, ref si, out pi);
    }
}
"@
}

function launched {
    param([string]$App)
    if ($App -ieq 'AURA') {
        [AuraLauncher]::Launch((Join-Path $PSScriptRoot "aura.exe"))
        exit
    } else {
        Write-Host "Usage : launched AURA"
    }
}
