import ExpoModulesCore

public class ScreenShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CiisScreenShare")

    Events("onFrame", "onStatus")

    // iOS cannot capture the screen outside the app itself (ReplayKit records only the host
    // app, with its own prompt). Whole-device screen share is not available, so this is a no-op.
    Function("isSupported") { () -> Bool in
      return false
    }

    AsyncFunction("start") { (_ intervalMs: Double) in
      self.sendEvent("onStatus", ["state": "error", "message": "Screen share is not available on iOS."])
    }

    AsyncFunction("stop") {
      self.sendEvent("onStatus", ["state": "stopped"])
    }
  }
}
