import ExpoModulesCore

public class CallLogModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CiisCallLog")

    AsyncFunction("readCallLog") { (_ sinceMillis: Double) -> [[String: Any]] in
      // iOS does not expose the cellular call history database to third-party apps.
      return []
    }
  }
}
