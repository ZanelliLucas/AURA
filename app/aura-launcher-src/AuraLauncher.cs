// Lanceur natif d'AURA (F-12/F-22, "launched AURA"). Compile une seule
// fois a la construction du paquet (scripts/fix-exe-subsystem.js), pas
// a chaque invocation depuis le profil PowerShell : evite le cout (et
// la variabilite - antivirus compris) d'une compilation Add-Type a
// chaud a chaque lancement.
//
// Lance aura.exe (situe a cote de ce lanceur) avec DETACHED_PROCESS
// (aucune console heritee/allouee) + CREATE_BREAKAWAY_FROM_JOB (sort du
// Job Object du shell appelant, sur lequel Windows Terminal peut se
// baser pour savoir quand un onglet doit vraiment se fermer). Compile
// lui-meme en sous-systeme Windows (/target:winexe) : aucune console
// ne lui est jamais allouee non plus.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class AuraLauncher
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool CreateProcess(
        string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags,
        IntPtr lpEnvironment, string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    private const uint DETACHED_PROCESS = 0x00000008;
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;

    private static void Main()
    {
        string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string auraPath = Path.Combine(exeDir, "aura.exe");

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        PROCESS_INFORMATION pi;
        uint flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB;
        CreateProcess(auraPath, null, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, null, ref si, out pi);
    }
}
