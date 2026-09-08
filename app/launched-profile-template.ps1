# AURA - lanceur personnel (F-12/F-22), copie telle quelle par
# l'installateur dans le dossier d'installation ($INSTDIR). Se localise
# lui-meme via $PSScriptRoot : aucune substitution necessaire cote NSIS.
#
# CreateProcess avec DETACHED_PROCESS + CREATE_BREAKAWAY_FROM_JOB (non
# exposes par Start-Process/System.Diagnostics.Process) : sans ces deux
# indicateurs ensemble, Windows Terminal peut garder l'onglet ouvert
# apres la fermeture du shell - DETACHED_PROCESS seul empeche
# l'heritage de console, mais le nouveau processus reste par defaut
# dans le meme Job Object que le shell (utilise par Windows Terminal
# pour suivre la fin "reelle" d'un onglet) ; CREATE_BREAKAWAY_FROM_JOB
# en sort explicitement. aura.exe est en sous-systeme WINDOWS (patché a
# la compilation, scripts/fix-exe-subsystem.js) : combine aux deux
# indicateurs ci-dessous, aucune console n'est jamais demandee ni
# heritee, quelle que soit la maniere dont "launched AURA" est invoque.
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
    public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;

    public static string Launch(string exePath) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        PROCESS_INFORMATION pi;
        uint flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB;
        bool ok = CreateProcess(exePath, null, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi);
        if (!ok) { return "ECHEC, erreur Win32 = " + Marshal.GetLastWin32Error(); }
        return "OK, PID = " + pi.dwProcessId;
    }
}
"@
}

function launched {
    param([string]$App)
    if ($App -ieq 'AURA') {
        [AuraLauncher]::Launch((Join-Path $PSScriptRoot "aura.exe")) | Out-Null
        exit
    } else {
        Write-Host "Usage : launched AURA"
    }
}
