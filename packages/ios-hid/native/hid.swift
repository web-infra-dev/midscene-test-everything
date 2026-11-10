import Foundation

private let outputLock = NSLock()
func log(_ text: String) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
}
func respond(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock(); defer { outputLock.unlock() }
    FileHandle.standardOutput.write(data + Data([10]))
}

@main struct HIDHelper {
    static func main() {
        let peripheral = HIDPeripheral.shared
        peripheral.onHostsChanged = {
            DispatchQueue.global(qos: .userInitiated).async {
                respond(["event": "bluetooth-status", "result": peripheral.snapshot()])
            }
        }
        peripheral.start()
        DispatchQueue.global(qos: .userInitiated).async {
            while let line = readLine() {
                do {
                    guard let data = line.data(using: .utf8),
                          let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let id = request["id"] as? String,
                          let method = request["method"] as? String else { continue }
                    if method == "status" { respond(["id": id, "result": peripheral.snapshot()]); continue }
                    guard method == "send", let peer = request["peer"] as? String, let host = UUID(uuidString: peer),
                          let report = request["report"] as? UInt8, let reportID = ReportID(rawValue: report),
                          let bytes = request["bytes"] as? [UInt8] else {
                        respond(["id": id, "error": "Invalid HID command"]); continue
                    }
                    peripheral.send(reportID, bytes, to: host) { accepted in
                        if accepted { respond(["id": id, "result": true]) }
                        else { respond(["id": id, "error": "HID report unavailable, disconnected, or queue full"]) }
                    }
                } catch { log("Invalid native request: \(error)") }
            }
            exit(0)
        }
        RunLoop.main.run()
    }
}
