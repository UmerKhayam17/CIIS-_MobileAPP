package expo.modules.calllog

import android.Manifest
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the device call log (CallLog.Calls) and hands it to JS. Android only — iOS exposes
 * no call-log API. This reads metadata only (number, direction, time, duration); it does NOT
 * and cannot capture call audio. Collection is gated in JS behind the signed-in staff member's
 * disclosure acknowledgement and the READ_CALL_LOG runtime permission.
 */
class CallLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CallLog")

    // Synchronous check so JS can decide whether to prompt for the permission.
    Function("hasPermission") {
      val ctx = appContext.reactContext ?: return@Function false
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) ==
        PackageManager.PERMISSION_GRANTED
    }

    // Returns call-log rows newer than `sinceMillis` (epoch ms), oldest first, capped at `maxRows`.
    AsyncFunction("getCallLog") { sinceMillis: Double, maxRows: Int ->
      val ctx = appContext.reactContext ?: throw Exception("Android context is not available")
      if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALL_LOG) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        throw Exception("READ_CALL_LOG permission is not granted")
      }

      val projection = arrayOf(
        CallLog.Calls._ID,
        CallLog.Calls.NUMBER,
        CallLog.Calls.TYPE,
        CallLog.Calls.DATE,
        CallLog.Calls.DURATION
      )
      val selection = "${CallLog.Calls.DATE} > ?"
      val args = arrayOf(sinceMillis.toLong().toString())
      val sortOrder = "${CallLog.Calls.DATE} ASC"

      val rows = mutableListOf<Map<String, Any?>>()
      ctx.contentResolver.query(CallLog.Calls.CONTENT_URI, projection, selection, args, sortOrder)
        ?.use { c ->
          val idIx = c.getColumnIndex(CallLog.Calls._ID)
          val numIx = c.getColumnIndex(CallLog.Calls.NUMBER)
          val typeIx = c.getColumnIndex(CallLog.Calls.TYPE)
          val dateIx = c.getColumnIndex(CallLog.Calls.DATE)
          val durIx = c.getColumnIndex(CallLog.Calls.DURATION)
          while (c.moveToNext() && rows.size < maxRows) {
            val type = if (typeIx >= 0) c.getInt(typeIx) else 0
            rows.add(
              mapOf(
                "id" to (if (idIx >= 0) c.getString(idIx) else null),
                "number" to (if (numIx >= 0) c.getString(numIx) else null ?: ""),
                "type" to type,
                "direction" to directionOf(type),
                "timestamp" to (if (dateIx >= 0) c.getLong(dateIx) else 0L),
                "duration" to (if (durIx >= 0) c.getLong(durIx) else 0L)
              )
            )
          }
        }
      rows
    }
  }

  private fun directionOf(type: Int): String = when (type) {
    CallLog.Calls.INCOMING_TYPE -> "inbound"
    CallLog.Calls.OUTGOING_TYPE -> "outbound"
    CallLog.Calls.MISSED_TYPE -> "missed"
    CallLog.Calls.REJECTED_TYPE -> "rejected"
    else -> "unknown"
  }
}
