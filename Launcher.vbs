Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' Check Python is installed
If sh.Run("py --version", 0, True) <> 0 Then
    MsgBox "Python 3 is required to run Roster Monster." & vbCrLf & _
           "Download it from https://python.org", 16, "Roster Monster"
    WScript.Quit
End If

' Ensure pystray and Pillow are available in system Python
sh.Run "py -m pip install pystray==0.19.5 Pillow==10.4.0 -q", 0, True

' Launch the tray app silently (window style 0 = hidden)
sh.Run "pythonw """ & root & "\Launcher.pyw""", 0, False
