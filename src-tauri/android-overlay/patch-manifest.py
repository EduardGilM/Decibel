import sys
p = sys.argv[1]; s = open(p).read()
if "MediaPlaybackService" not in s:
    s = s.replace('''    <uses-permission android:name="android.permission.INTERNET" />''', '''    <uses-permission android:name="android.permission.INTERNET" />
    <!-- Background playback (0.1.4): foreground media service, notification, CPU/Wi-Fi locks -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />''', 1)
    s = s.replace('''        <provider''', '''        <service
            android:name=".MediaPlaybackService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />

        <provider''', 1)
    assert s.count("MediaPlaybackService") == 1 and "WAKE_LOCK" in s
    open(p + ".tmp", "w").write(s)
    import os; os.replace(p + ".tmp", p)
print("manifest ok")
