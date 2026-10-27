package expo.modules.screenshare

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * A visible foreground service that must be running (with type mediaProjection) before a
 * MediaProjection is obtained on Android 14+. It exists so the OS keeps showing the recording
 * indicator and the session is never silent.
 */
class ScreenShareService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelId = "ciis_screen_share"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(channelId) == null) {
        manager.createNotificationChannel(
          NotificationChannel(channelId, "Screen share", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
    val notification: Notification = Notification.Builder(this, channelId)
      .setContentTitle("CIIS screen share")
      .setContentText("You are sharing your screen with the control room.")
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    return START_NOT_STICKY
  }

  companion object {
    const val NOTIFICATION_ID = 7711
  }
}
