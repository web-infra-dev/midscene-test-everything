import AVFoundation
import Foundation

/// One discovery session for the device service lifetime. stdin/stdout carry JSON lines;
/// this process never creates an AVCaptureSession or starts screen recording.
final class USBDiscovery {
    private let discovery: AVCaptureDevice.DiscoverySession
    private let identities = USBIdentityReader()
    private var observation: NSKeyValueObservation?
    private var connectionObservations: [NSKeyValueObservation] = []
    private var ready = false
    private var waiting: [String] = []

    init() {
        allowUSBScreenDevices()
        discovery = AVCaptureDevice.DiscoverySession(deviceTypes: [.external], mediaType: .muxed,
                                                     position: .unspecified)
        observation = discovery.observe(\.devices, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.observeConnections(); self?.publish() }
        }
        identities.onChange = { [weak self] in self?.publish() }
        observeConnections()
    }
    private func observeConnections() {
        connectionObservations = discovery.devices.map { device in
            device.observe(\.isConnected, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.publish() }
            }
        }
    }
    private func snapshot() -> [String: Any] {
        let devices = discovery.devices.filter { $0.isConnected && $0.modelID.contains("iOS") }
        return [
            "devices": devices.map { ["id": $0.uniqueID, "name": $0.localizedName, "model": $0.modelID] },
            "identities": identities.devices,
            "authorization": AVCaptureDevice.authorizationStatus(for: .video).rawValue
        ]
    }
    private func write(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }
    private func publish() {
        guard ready else { return }
        write(["event": "usb-devices", "result": snapshot()])
    }
    private func list(_ id: String) {
        guard ready else { waiting.append(id); return }
        write(["id": id, "result": snapshot()])
    }
    func run() {
        // Let the initial asynchronous discovery settle once, not on each refresh.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
            ready = true
            publish()
            let pending = waiting
            waiting.removeAll()
            for id in pending { list(id) }
        }
        DispatchQueue.global(qos: .utility).async { [self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let id = request["id"] as? String else { continue }
                let isList = request["method"] as? String == "list"
                DispatchQueue.main.async { [self] in
                    if isList { list(id) }
                    else { write(["id": id, "error": "Unknown USB discovery method"]) }
                }
            }
            exit(0)
        }
        RunLoop.main.run()
    }
}
