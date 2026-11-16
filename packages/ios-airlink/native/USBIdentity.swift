import Foundation
import Darwin

// Optional read-only metadata from macOS MobileDevice.framework. No pairing,
// settings writes or phone-side software. Failure never blocks screen discovery.
final class USBIdentityReader {
    typealias DeviceCall = @convention(c) (UnsafeMutableRawPointer?) -> Int32
    typealias CopyValue = @convention(c) (UnsafeMutableRawPointer?, CFString?, CFString?) -> Unmanaged<CFTypeRef>?
    typealias Callback = @convention(c) (UnsafeRawPointer?, UnsafeMutableRawPointer?) -> Void
    typealias Subscribe = @convention(c) (Callback?, UInt32, UInt32, UInt32, UnsafeMutablePointer<UnsafeMutableRawPointer?>?) -> Int32
    typealias Unsubscribe = @convention(c) (UnsafeMutableRawPointer?) -> Int32
    private static weak var current: USBIdentityReader?
    private let library: UnsafeMutableRawPointer?
    private var subscription: UnsafeMutableRawPointer?
    var onChange: (() -> Void)?
    private(set) var devices: [[String: String]] = []

    init() {
        library = dlopen("/System/Library/PrivateFrameworks/MobileDevice.framework/MobileDevice", RTLD_LAZY)
        guard let subscribe: Subscribe = symbol("AMDeviceNotificationSubscribe") else { return }
        Self.current = self
        let callback: Callback = { info, _ in
            guard let info,
                  let device = info.load(as: UnsafeMutableRawPointer?.self) else { return }
            let event = info.load(fromByteOffset: MemoryLayout<UnsafeRawPointer>.size, as: UInt32.self)
            if event == 1 { USBIdentityReader.current?.read(device) }
            else if event == 2 { USBIdentityReader.current?.remove(device) }
        }
        if subscribe(callback, 0, 0, 0, &subscription) != 0 { subscription = nil }
    }
    deinit {
        if let unsubscribe: Unsubscribe = symbol("AMDeviceNotificationUnsubscribe"), let subscription {
            _ = unsubscribe(subscription)
        }
        // The framework can still have callbacks queued during process exit.
        // Leave its image loaded for this short-lived helper's remaining lifetime.
    }
    private func symbol<T>(_ name: String) -> T? {
        guard let library, let pointer = dlsym(library, name) else { return nil }
        return unsafeBitCast(pointer, to: T.self)
    }
    private func remove(_ device: UnsafeMutableRawPointer) {
        typealias CopyIdentifier = @convention(c) (UnsafeMutableRawPointer?) -> Unmanaged<CFString>?
        guard let interface: DeviceCall = symbol("AMDeviceGetInterfaceType"), interface(device) == 1,
              let copy: CopyIdentifier = symbol("AMDeviceCopyDeviceIdentifier"),
              let id = copy(device)?.takeRetainedValue() as String? else { return }
        devices.removeAll { $0["id"] == id }
        onChange?()
    }
    private func read(_ device: UnsafeMutableRawPointer) {
        guard let interface: DeviceCall = symbol("AMDeviceGetInterfaceType"), interface(device) == 1,
              let paired: DeviceCall = symbol("AMDeviceIsPaired"),
              let connect: DeviceCall = symbol("AMDeviceConnect"),
              let disconnect: DeviceCall = symbol("AMDeviceDisconnect"),
              let validate: DeviceCall = symbol("AMDeviceValidatePairing"),
              let start: DeviceCall = symbol("AMDeviceStartSession"),
              let stop: DeviceCall = symbol("AMDeviceStopSession"),
              let copy: CopyValue = symbol("AMDeviceCopyValue"), connect(device) == 0 else { return }
        defer { _ = disconnect(device) }
        guard paired(device) == 1, validate(device) == 0, start(device) == 0 else { return }
        defer { _ = stop(device) }
        func value(_ key: String) -> String? {
            guard let copied = copy(device, nil, key as CFString)?.takeRetainedValue() else { return nil }
            return copied as? String
        }
        guard let id = value("UniqueDeviceID"), let name = value("DeviceName"),
              let productType = value("ProductType") else { return }
        devices.removeAll { $0["id"] == id }
        devices.append(["id": id, "name": name, "productType": productType])
        onChange?()
    }
}
