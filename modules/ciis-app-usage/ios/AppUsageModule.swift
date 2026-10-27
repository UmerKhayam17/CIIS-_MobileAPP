import ExpoModulesCore

public class AppUsageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CiisAppUsage")

    // iOS does not expose other apps' usage to third-party apps. Screen Time's
    // DeviceActivity/FamilyControls only gives coarse category buckets behind a special
    // Apple entitlement and cannot be read as a usage log, so these are no-ops.
    Function("hasUsageAccess") { () -> Bool in
      return false
    }

    Function("openUsageAccessSettings") {
      // No equivalent settings screen exists on iOS.
    }

    AsyncFunction("readUsage") { (_ sinceMillis: Double) -> [[String: Any]] in
      return []
    }
  }
}
