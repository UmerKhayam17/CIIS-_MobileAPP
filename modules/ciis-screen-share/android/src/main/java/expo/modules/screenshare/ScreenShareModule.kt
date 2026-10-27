package expo.modules.screenshare

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Consented, VISIBLE screen share. The employee starts each session; Android shows its own
 * consent dialog and a persistent recording indicator the whole time. This module cannot start
 * capture silently, auto-start it, or hide the indicator — attempting any of that is explicitly
 * out of scope. Frames are written to the app cache and handed to JS to upload with consent.
 *
 * NOTE: the MediaProjection capture loop below must be validated on a real development build;
 * it cannot be exercised in Expo Go or without a device.
 */
class ScreenShareModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var projection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var intervalMs: Long = 4000
  private var capturing = false
  private val ticker = object : Runnable {
    override fun run() {
      if (!capturing) return
      captureFrame()
      mainHandler.postDelayed(this, intervalMs)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("CiisScreenShare")

    Events("onFrame", "onStatus")

    Function("isSupported") {
      val ctx = appContext.reactContext
      ctx?.getSystemService(Context.MEDIA_PROJECTION_SERVICE) != null
    }

    AsyncFunction("start") { interval: Double ->
      intervalMs = interval.toLong().coerceIn(1000, 60000)
      val activity = appContext.currentActivity ?: throw IllegalStateException("No foreground activity")
      val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      sendEvent("onStatus", mapOf("state" to "requesting"))
      activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    AsyncFunction("stop") {
      stopCapture()
      sendEvent("onStatus", mapOf("state" to "stopped"))
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_CAPTURE) return@OnActivityResult
      val data = payload.data
      if (payload.resultCode != android.app.Activity.RESULT_OK || data == null) {
        sendEvent("onStatus", mapOf("state" to "denied"))
        return@OnActivityResult
      }
      try {
        beginCapture(payload.resultCode, data)
      } catch (e: Exception) {
        sendEvent("onStatus", mapOf("state" to "error", "message" to (e.message ?: "")))
      }
    }
  }

  private fun beginCapture(resultCode: Int, data: Intent) {
    val ctx = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
    // Start the visible foreground service BEFORE obtaining the projection (Android 14 rule).
    ctx.startForegroundService(Intent(ctx, ScreenShareService::class.java))

    val manager = ctx.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val mp = manager.getMediaProjection(resultCode, data)
      ?: throw IllegalStateException("Unable to obtain a media projection")
    mp.registerCallback(object : MediaProjection.Callback() {
      override fun onStop() {
        stopCapture()
        sendEvent("onStatus", mapOf("state" to "stopped"))
      }
    }, mainHandler)
    projection = mp

    val metrics = DisplayMetrics()
    (ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealMetrics(metrics)
    // Downscale for bandwidth; keep aspect ratio.
    val scale = if (metrics.widthPixels > 720) 720.0 / metrics.widthPixels else 1.0
    val width = (metrics.widthPixels * scale).toInt().coerceAtLeast(1)
    val height = (metrics.heightPixels * scale).toInt().coerceAtLeast(1)

    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    imageReader = reader
    virtualDisplay = mp.createVirtualDisplay(
      "ciis-screen-share",
      width,
      height,
      metrics.densityDpi,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      mainHandler,
    )
    capturing = true
    sendEvent("onStatus", mapOf("state" to "active"))
    mainHandler.postDelayed(ticker, intervalMs)
  }

  private fun captureFrame() {
    val reader = imageReader ?: return
    val image = reader.acquireLatestImage() ?: return
    try {
      val plane = image.planes[0]
      val buffer = plane.buffer
      val pixelStride = plane.pixelStride
      val rowStride = plane.rowStride
      val rowPadding = rowStride - pixelStride * image.width
      val bitmap = Bitmap.createBitmap(
        image.width + rowPadding / pixelStride,
        image.height,
        Bitmap.Config.ARGB_8888,
      )
      bitmap.copyPixelsFromBuffer(buffer)
      val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)

      val ctx = appContext.reactContext ?: return
      val out = File(ctx.cacheDir, "screen_${System.currentTimeMillis()}.jpg")
      FileOutputStream(out).use { fos ->
        cropped.compress(Bitmap.CompressFormat.JPEG, 55, fos)
      }
      bitmap.recycle()
      cropped.recycle()
      sendEvent("onFrame", mapOf("uri" to "file://${out.absolutePath}", "capturedAt" to System.currentTimeMillis().toDouble()))
    } catch (_: Exception) {
      // Skip a bad frame; the next tick tries again.
    } finally {
      image.close()
    }
  }

  private fun stopCapture() {
    capturing = false
    mainHandler.removeCallbacks(ticker)
    virtualDisplay?.release()
    virtualDisplay = null
    imageReader?.close()
    imageReader = null
    projection?.stop()
    projection = null
    val ctx = appContext.reactContext
    if (ctx != null) ctx.stopService(Intent(ctx, ScreenShareService::class.java))
  }

  companion object {
    private const val REQUEST_CAPTURE = 0xC115
  }
}
