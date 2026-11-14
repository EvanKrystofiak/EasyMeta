// EasyMeta launcher: opens EasyMeta.html (next to this exe) in its own Edge or
// Chrome "app" window (no tabs or address bar).  Falls back to the default
// browser.  Build with launcher\build_launcher.bat (uses the .NET Framework
// compiler that ships with Windows; nothing to install).
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("EasyMeta")]
[assembly: AssemblyDescription("Opens EasyMeta, the microscopy metadata viewer, in its own browser window")]
[assembly: AssemblyProduct("EasyMeta")]
[assembly: AssemblyCopyright("Copyright © 2026 Evan Krystofiak")]
[assembly: AssemblyVersion("0.1.1.0")]
[assembly: AssemblyFileVersion("0.1.1.0")]

static class Launcher
{
    [STAThread]
    static int Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string html = Path.Combine(dir, "EasyMeta.html");
        if (!File.Exists(html))
        {
            MessageBox.Show("EasyMeta.html was not found next to EasyMeta.exe.\n\nKeep EasyMeta.exe inside the EasyMeta folder.",
                "EasyMeta", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        string url = new Uri(html).AbsoluteUri;
        string browser = FindBrowser();
        try
        {
            if (browser != null)
            {
                var psi = new ProcessStartInfo(browser, "--app=\"" + url + "\" --window-size=1480,940 --no-first-run");
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else
            {
                Process.Start(new ProcessStartInfo(html) { UseShellExecute = true });
            }
        }
        catch (Exception e)
        {
            MessageBox.Show("Could not start a browser:\n" + e.Message + "\n\nOpen EasyMeta.html in Edge, Chrome or Firefox instead.",
                "EasyMeta", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }

    static string FindBrowser()
    {
        string pf = Environment.GetEnvironmentVariable("ProgramFiles") ?? @"C:\Program Files";
        string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? @"C:\Program Files (x86)";
        string local = Environment.GetEnvironmentVariable("LocalAppData") ?? "";
        string[] candidates =
        {
            Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
        };
        foreach (string c in candidates)
            if (File.Exists(c)) return c;
        return null;
    }
}
