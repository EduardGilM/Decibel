package app.decibel.music

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * mediaPlayback foreground service: keeps the process (and the WebView playing the audio) alive and
 * unthrottled in the background, and shows the MediaStyle notification / lock-screen controls.
 * Foreground while playing; after 10 minutes paused it leaves the foreground state (the notification
 * stays and can be dismissed), so a forgotten pause does not pin the app in memory forever.
 */
class MediaPlaybackService : Service() {
  companion object {
    private const val TAG = "DecibelService"
    private const val CHANNEL = "playback"
    private const val NOTIFICATION_ID = 7300
    private const val ACTION_REFRESH = "app.decibel.music.REFRESH"
    private const val ACTION_TOGGLE = "app.decibel.music.TOGGLE"
    private const val ACTION_NEXT = "app.decibel.music.NEXT"
    private const val ACTION_PREV = "app.decibel.music.PREV"
    private const val ACTION_DISMISS = "app.decibel.music.DISMISS"
    private var instance: MediaPlaybackService? = null
    private val running get() = instance != null
    /** "off", "foreground" or "background" (diagnostics). */
    val state get() = instance?.let { if (it.foreground) "foreground" else "background" } ?: "off"
    var lastError: String? = null; private set

    fun start(context: Context) {
      if (running) { refresh(context); return }
      val intent = Intent(context, MediaPlaybackService::class.java).setAction(ACTION_REFRESH)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      } catch (e: Exception) { lastError = "start: ${e.javaClass.simpleName}"; Log.w(TAG, "cannot start playback service", e) } // e.g. started from the background on 12+
    }

    /** Direct call, not an Intent: startService from the background is refused on Android 8+. */
    fun refresh(@Suppress("UNUSED_PARAMETER") context: Context) {
      instance?.show()
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MediaPlaybackService::class.java))
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var foreground = false
  private val leaveForeground = Runnable {
    if (!DecibelMedia.playing && foreground) {
      foreground = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_DETACH) else @Suppress("DEPRECATION") stopForeground(false)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reproducción", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Controles de la canción que está sonando"
        setShowBadge(false)
      })
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_TOGGLE -> if (DecibelMedia.playing) DecibelMedia.pauseBy("user", "botón de la notificación") else DecibelMedia.command("play")
      ACTION_NEXT -> DecibelMedia.command(if (DecibelMedia.podcast) "forward" else "next")
      ACTION_PREV -> DecibelMedia.command(if (DecibelMedia.podcast) "back" else "prev")
      ACTION_DISMISS -> { if (DecibelMedia.playing) DecibelMedia.pauseBy("user", "notificación descartada"); stopSelf(); return START_NOT_STICKY }
    }
    show()
    return START_NOT_STICKY // without the WebView there is nothing to resume
  }

  private fun show() {
    val notification = build()
    if (DecibelMedia.playing || !foreground) {
      main.removeCallbacks(leaveForeground)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION_ID, notification)
        if (!foreground) Log.i(TAG, "foreground service started")
        foreground = true
        lastError = null
      } catch (e: Exception) {
        lastError = "startForeground: ${e.javaClass.simpleName}"
        Log.w(TAG, "startForeground", e)
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
      }
    } else getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    if (!DecibelMedia.playing) { main.removeCallbacks(leaveForeground); main.postDelayed(leaveForeground, 10 * 60_000L) }
  }

  private fun pending(action: String, code: Int): PendingIntent =
    PendingIntent.getService(this, code, Intent(this, MediaPlaybackService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun build(): Notification {
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    fun action(icon: Int, label: String, action: String, code: Int) =
      Notification.Action.Builder(Icon.createWithResource(this, icon), label, pending(action, code)).build()
    val playing = DecibelMedia.playing
    val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
    DecibelMedia.session?.let { style.setMediaSession(it.sessionToken) }
    return builder
      .setSmallIcon(R.drawable.ic_stat_decibel)
      .setContentTitle(DecibelMedia.title.ifEmpty { "Decibel" })
      .setContentText(DecibelMedia.artist)
      .setSubText(DecibelMedia.album.ifEmpty { null })
      .setLargeIcon(DecibelMedia.art)
      .setContentIntent(open)
      .setDeleteIntent(pending(ACTION_DISMISS, 4))
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_TRANSPORT)
      .setOngoing(playing)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .addAction(if (DecibelMedia.podcast) action(android.R.drawable.ic_media_rew, "Retroceder 15 s", ACTION_PREV, 1) else action(android.R.drawable.ic_media_previous, "Anterior", ACTION_PREV, 1))
      .addAction(if (playing) action(android.R.drawable.ic_media_pause, "Pausar", ACTION_TOGGLE, 2) else action(android.R.drawable.ic_media_play, "Reproducir", ACTION_TOGGLE, 2))
      .addAction(if (DecibelMedia.podcast) action(android.R.drawable.ic_media_ff, "Avanzar 30 s", ACTION_NEXT, 3) else action(android.R.drawable.ic_media_next, "Siguiente", ACTION_NEXT, 3))
      .setStyle(style)
      .build()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // App swiped away from recents: the WebView is gone with it, so stop cleanly.
    DecibelMedia.release()
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    instance = null
    foreground = false
    main.removeCallbacksAndMessages(null)
    getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
    super.onDestroy()
  }
}
