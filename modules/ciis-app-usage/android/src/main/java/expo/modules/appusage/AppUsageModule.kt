package expo.modules.appusage

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads per-app foreground usage via Android's UsageStatsManager. This exposes app package
 * names and durations only — never the content shown inside those apps. Access requires the
 * "Usage access" special permission, which the user must grant manually in system settings
 * (there is no silent grant). iOS has no equivalent and returns an empty list.
 */
class AppUsageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CiisAppUsage")

    Function("hasUsageAccess") {
      hasUsageAccess()
    }

    Function("openUsageAccessSettings") {
      val ctx = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    }

    AsyncFunction("readUsage") { sinceMillis: Double ->
      if (sinceMillis <= 0.0) {
        throw IllegalArgumentException("sinceMillis is required")
      }
      if (!hasUsageAccess()) {
        throw SecurityException("Usage access is not granted")
      }
      query(sinceMillis.toLong())
    }
  }

  private fun hasUsageAccess(): Boolean {
    val ctx = appContext.reactContext ?: return false
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode = appOps.unsafeCheckOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS,
      Process.myUid(),
      ctx.packageName,
    )
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun query(sinceMillis: Long): List<Map<String, Any?>> {
    val ctx = appContext.reactContext ?: throw IllegalStateException("Android context is unavailable")
    val manager = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
      ?: throw IllegalStateException("UsageStatsManager is unavailable")
    val now = System.currentTimeMillis()
    val pm = ctx.packageManager

    // queryAndAggregateUsageStats merges duplicate daily buckets per package for the window.
    val aggregated = manager.queryAndAggregateUsageStats(sinceMillis, now)
    val rows = mutableListOf<Map<String, Any?>>()
    for ((pkg, stats) in aggregated) {
      val foregroundMs = stats.totalTimeInForeground
      if (foregroundMs <= 0L) continue
      val label = try {
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
      } catch (_: Exception) {
        pkg
      }
      rows.add(
        mapOf(
          "packageName" to pkg,
          "appLabel" to label,
          "foregroundSeconds" to (foregroundMs / 1000.0),
          "launchCount" to 0.0,
          "windowStart" to sinceMillis.toDouble(),
          "windowEnd" to now.toDouble(),
          "lastUsedAt" to stats.lastTimeUsed.toDouble(),
        ),
      )
    }
    return rows
  }
}
