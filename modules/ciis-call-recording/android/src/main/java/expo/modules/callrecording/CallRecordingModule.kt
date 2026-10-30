package expo.modules.callrecording

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Uploads call-audio files the phone's OWN dialer already recorded — this module never records
 * a call itself (Android does not permit that for a third-party app, by design). After the
 * employee grants audio access, it finds those files in the media library (the usual dialer
 * folders). A folder the employee picked earlier is still used when one is stored.
 *
 * NOTE: this must be validated on a real development build against the actual OEM dialer's
 * recordings; it cannot be exercised in Expo Go.
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

    Function("hasAudioAccess") {
      hasAudioPermission()
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
      val since = sinceMillis.toLong()
      val tree = storedUri()?.let { DocumentFile.fromTreeUri(ctx(), it) }
      if (tree == null || !tree.canRead()) {
        return@AsyncFunction listFromMediaStore(since)
      }
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

  private fun hasAudioPermission(): Boolean {
    val perm = if (Build.VERSION.SDK_INT >= 33) {
      Manifest.permission.READ_MEDIA_AUDIO
    } else {
      Manifest.permission.READ_EXTERNAL_STORAGE
    }
    return ctx().checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED
  }

  /** Audio the media library already indexed, limited to the dialer's usual call-recording locations. */
  private fun listFromMediaStore(sinceMillis: Long): List<Map<String, Any>> {
    if (!hasAudioPermission()) {
      throw SecurityException("Audio access is not granted")
    }
    val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val projection = mutableListOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.DISPLAY_NAME,
      MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.DATE_MODIFIED,
    )
    if (Build.VERSION.SDK_INT >= 29) projection.add(MediaStore.Audio.Media.RELATIVE_PATH)

    val out = mutableListOf<Map<String, Any>>()
    ctx().contentResolver.query(
      collection,
      projection.toTypedArray(),
      "${MediaStore.Audio.Media.DATE_MODIFIED} >= ?",
      arrayOf((sinceMillis / 1000).toString()),
      "${MediaStore.Audio.Media.DATE_MODIFIED} DESC",
    )?.use { cursor ->
      val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
      val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
      val sizeIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
      val modIdx = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
      val relIdx = if (Build.VERSION.SDK_INT >= 29) {
        cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH)
      } else {
        -1
      }
      while (cursor.moveToNext() && out.size < MAX_FILES) {
        val name = cursor.getString(nameIdx) ?: ""
        val relative = if (relIdx >= 0) cursor.getString(relIdx) ?: "" else ""
        if (!isCallRecording(relative, name)) continue
        val id = cursor.getLong(idIdx)
        out.add(
          mapOf(
            "id" to "media:$id",
            "uri" to ContentUris.withAppendedId(collection, id).toString(),
            "name" to name,
            "sizeBytes" to cursor.getLong(sizeIdx).toDouble(),
            "modified" to (cursor.getLong(modIdx) * 1000).toDouble(),
          ),
        )
      }
    }
    return out
  }

  private fun isCallRecording(relative: String, name: String): Boolean {
    val path = relative.lowercase().replace('\\', '/').trim('/')
    if (path.isNotEmpty()) {
      val segments = path.split('/')
      if (segments.any { seg ->
          CALL_SEGMENTS.any { hint -> seg == hint || (hint.length >= 8 && seg.contains(hint)) }
        }
      ) return true
      if (CALL_PATHS.any { path.contains(it) }) return true
    }
    val fileName = name.lowercase()
    return NAME_HINTS.any { fileName.contains(it) }
  }

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
    val CALL_SEGMENTS = listOf(
      "call",
      "calls",
      "callrecord",
      "call_record",
      "call recordings",
      "call_recordings",
      "call recording",
    )
    val CALL_PATHS = listOf(
      "sound_recorder/call",
      "sounds/callrecord",
      "phonerecord",
      "phone_recorder",
    )
    val NAME_HINTS = listOf("call recording", "callrecord", "call_rec", "call-rec")
  }
}
