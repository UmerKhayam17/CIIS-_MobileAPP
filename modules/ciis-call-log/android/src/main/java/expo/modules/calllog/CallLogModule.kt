package expo.modules.calllog

import android.Manifest
import android.content.pm.PackageManager
import android.provider.CallLog
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CallLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CiisCallLog")

    AsyncFunction("readCallLog") { sinceMillis: Double ->
      if (sinceMillis <= 0.0) {
        throw IllegalArgumentException("sinceMillis is required")
      }
      val ctx = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
      if (ctx.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException("READ_CALL_LOG is not granted")
      }
      try {
        query(sinceMillis.toLong(), includeAccount = true)
      } catch (_: IllegalArgumentException) {
        query(sinceMillis.toLong(), includeAccount = false)
      }
    }
  }

  private fun query(sinceMillis: Long, includeAccount: Boolean): List<Map<String, Any?>> {
    val resolver = appContext.reactContext?.contentResolver
      ?: throw IllegalStateException("Android context is unavailable")
    val columns = mutableListOf(
      CallLog.Calls._ID,
      CallLog.Calls.NUMBER,
      CallLog.Calls.TYPE,
      CallLog.Calls.DATE,
      CallLog.Calls.DURATION,
    )
    if (includeAccount) columns.add(CallLog.Calls.PHONE_ACCOUNT_ID)

    val rows = mutableListOf<Map<String, Any?>>()
    resolver.query(
      CallLog.Calls.CONTENT_URI,
      columns.toTypedArray(),
      "${CallLog.Calls.DATE} >= ?",
      arrayOf(sinceMillis.toString()),
      "${CallLog.Calls.DATE} DESC LIMIT 200",
    )?.use { cursor ->
      val idIdx = cursor.getColumnIndex(CallLog.Calls._ID)
      val numberIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
      val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
      val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
      val durationIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
      val accountIdx = if (includeAccount) cursor.getColumnIndex(CallLog.Calls.PHONE_ACCOUNT_ID) else -1
      while (cursor.moveToNext()) {
        val id = if (idIdx >= 0) cursor.getLong(idIdx).toString() else ""
        if (id.isEmpty()) continue
        val type = if (typeIdx >= 0) cursor.getInt(typeIdx) else 0
        val started = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
        if (started <= 0L) continue
        rows.add(
          mapOf(
            "id" to id,
            "number" to (if (numberIdx >= 0) cursor.getString(numberIdx) ?: "" else ""),
            "direction" to directionFor(type),
            "startedAt" to started.toDouble(),
            "durationSeconds" to (if (durationIdx >= 0) cursor.getLong(durationIdx).toDouble() else 0.0),
            "simSlot" to (if (accountIdx >= 0) cursor.getString(accountIdx) ?: "" else ""),
          ),
        )
      }
    }
    return rows
  }

  private fun directionFor(type: Int): String {
    return when (type) {
      CallLog.Calls.INCOMING_TYPE -> "inbound"
      CallLog.Calls.OUTGOING_TYPE -> "outbound"
      CallLog.Calls.MISSED_TYPE, 5, 6 -> "missed"
      else -> "unknown"
    }
  }
}
