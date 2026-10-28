package expo.modules.callrecording

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Uploads call-audio files the phone's OWN dialer already recorded — this module never records
 * a call itself (Android does not permit that for a third-party app, by design). The employee
 * grants read access to their call-recordings folder once via the system folder picker (SAF),
 * and this module lists and reads the audio files in it so JS can upload them with consent.
 *
 * NOTE: folder/file access must be validated on a real development build against the actual
 * OEM dialer's recordings folder; it cannot be exercised in Expo Go.
 */
class CallRecordingModule : Module() {
  private var pendingPicker: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("CiisCallRecording")

    Function("getFolderUri") {
      val uri = storedUri() ?: return@Function null
      // Confirm we still hold a persisted grant; the OS can drop it.
      val held = ctx().contentResolver.persistedUriPermissions.any {
        it.uri == uri && it.isReadPermission
      }
      if (held) uri.toString() else null
    }

    AsyncFunction("requestFolderAccess") { promise: Promise ->
      if (pendingPicker != null) {
        promise.reject("BUSY", "A folder request is already in progress", null)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "No foreground activity", null)
        return@AsyncFunction
      }
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
      }
      pendingPicker = promise
      activity.startActivityForResult(intent, REQUEST_FOLDER)
    }

    AsyncFunction("listRecordings") { sinceMillis: Double ->
      val tree = storedUri()?.let { DocumentFile.fromTreeUri(ctx(), it) }
        ?: throw IllegalStateException("No call-recordings folder has been selected")
      val since = sinceMillis.toLong()
      tree.listFiles()
        .asSequence()
        .filter { it.isFile && it.lastModified() >= since && isAudio(it) }
        .sortedByDescending { it.lastModified() }
        .take(MAX_FILES)
        .map {
          mapOf(
            "id" to (it.name ?: it.uri.lastPathSegment ?: it.uri.toString()),
            "uri" to it.uri.toString(),
            "name" to (it.name ?: ""),
            "sizeBytes" to it.length().toDouble(),
            "modified" to it.lastModified().toDouble(),
          )
        }
        .toList()
    }

    AsyncFunction("copyToCache") { uriStr: String ->
      val src = Uri.parse(uriStr)
      val dir = File(ctx().cacheDir, "call_recordings").apply { mkdirs() }
      val out = File(dir, "rec_${System.currentTimeMillis()}_${src.lastPathSegment?.hashCode()}")
      ctx().contentResolver.openInputStream(src)?.use { input ->
        FileOutputStream(out).use { output -> input.copyTo(output) }
      } ?: throw IllegalStateException("Could not open recording for reading")
      "file://${out.absolutePath}"
    }

    AsyncFunction("deleteCache") { path: String ->
      val f = File(path.removePrefix("file://"))
      // Only ever delete inside our own call-recordings cache.
      val safe = File(ctx().cacheDir, "call_recordings")
      if (f.absolutePath.startsWith(safe.absolutePath) && f.exists()) f.delete() else false
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_FOLDER) return@OnActivityResult
      val promise = pendingPicker ?: return@OnActivityResult
      pendingPicker = null
      val data = payload.data
      val treeUri = data?.data
      if (payload.resultCode != android.app.Activity.RESULT_OK || treeUri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      try {
        val flags = (data.flags and
          (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION))
        ctx().contentResolver.takePersistableUriPermission(
          treeUri,
          if (flags != 0) flags else Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
        prefs().edit().putString(KEY_TREE_URI, treeUri.toString()).apply()
        promise.resolve(treeUri.toString())
      } catch (e: Exception) {
        promise.reject("GRANT_FAILED", e.message ?: "Could not persist folder access", e)
      }
    }
  }

  private fun ctx(): Context =
    appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")

  private fun prefs() = ctx().getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun storedUri(): Uri? = prefs().getString(KEY_TREE_URI, null)?.let { Uri.parse(it) }

  private fun isAudio(doc: DocumentFile): Boolean {
    val type = doc.type ?: ""
    if (type.startsWith("audio/")) return true
    val name = (doc.name ?: "").lowercase()
    return AUDIO_EXT.any { name.endsWith(it) }
  }

  private companion object {
    const val REQUEST_FOLDER = 0xC115
    const val PREFS = "ciis_call_recording"
    const val KEY_TREE_URI = "tree_uri"
    const val MAX_FILES = 100
    val AUDIO_EXT = listOf(".mp3", ".m4a", ".amr", ".wav", ".aac", ".ogg", ".3gp", ".opus", ".mp4")
  }
}
