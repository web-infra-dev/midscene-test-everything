import AppKit
import AVFoundation
import Darwin
import CoreImage
import CoreMediaIO
import Foundation
import ImageIO
import UniformTypeIdentifiers

func note(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }
private var captureOutput: FileHandle?
func fail(_ text: String) -> Never {
    if let output = captureOutput {
        try? output.write(contentsOf: Data(("error " + text.replacingOccurrences(of: "\n", with: " ") + "\n").utf8))
    }
    note("USB error: " + text)
    exit(1)
}

private func connectCaptureSocket(_ path: String) -> FileHandle? {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = path.utf8CString
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { return nil }
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        bytes.withUnsafeBytes { destination.copyBytes(from: $0) }
    }
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard result == 0 else { close(fd); return nil }
    // EOF also stops capture if the Node service crashes or restarts.
    DispatchQueue.global(qos: .utility).async {
        var byte: UInt8 = 0
        while read(fd, &byte, 1) < 0 && errno == EINTR {}
        exit(0)
    }
    signal(SIGPIPE, SIG_IGN)
    return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
}

func allowUSBScreenDevices() {
    var address = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var allowed: UInt32 = 1
    let result = CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address,
                                          0, nil, UInt32(MemoryLayout<UInt32>.size), &allowed)
    if result != 0 { note("USB discovery status: \(result)") }
}

func phones() -> [AVCaptureDevice] {
    allowUSBScreenDevices()
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 1.5))
    let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: [.external], mediaType: .muxed,
                                                      position: .unspecified)
    for _ in 0..<16 {
        let found = discovery.devices.filter { $0.isConnected && $0.modelID.contains("iOS") }
        if !found.isEmpty { return found }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
    }
    return []
}

final class FrameWriter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let context = CIContext(options: [.cacheIntermediates: false])
    let destination: FileHandle
    init(destination: FileHandle) { self.destination = destination }
    var last = 0.0
    var count = 0
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = ProcessInfo.processInfo.systemUptime
        guard now - last >= 1.0 / 12.0,
              let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        last = now
        let original = CIImage(cvPixelBuffer: buffer)
        let scale = min(1.0, 1600.0 / max(original.extent.width, original.extent.height))
        let image = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cgImage = context.createCGImage(image, from: image.extent) else { return }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(destination, cgImage,
                                   [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return }
        do { try self.destination.write(contentsOf: data as Data) }
        catch { exit(1) }
        count += 1
        if count == 1 { note("USB first frame: \(cgImage.width)x\(cgImage.height)") }
    }
}

@main struct USBCapture {
    static func main() {
        if CommandLine.arguments.contains("watch") {
            let discovery = USBDiscovery()
            discovery.run()
            return
        }
        if CommandLine.arguments.contains("identities") {
            let reader = USBIdentityReader()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 1.5))
            FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: reader.devices))
            return
        }
        let arguments = CommandLine.arguments
        if arguments.count == 5 && arguments[1] == "capture" && arguments[3] == "--socket" {
            guard let connection = connectCaptureSocket(arguments[4]) else { exit(1) }
            captureOutput = connection
            _ = NSApplication.shared
        }
        let devices = phones()
        if CommandLine.arguments.contains("list") {
            let values = devices.map { ["id": $0.uniqueID, "name": $0.localizedName,
                                        "model": $0.modelID] }
            let data = try! JSONSerialization.data(withJSONObject: [
                "devices": values,
                "authorization": AVCaptureDevice.authorizationStatus(for: .video).rawValue
            ])
            FileHandle.standardOutput.write(data)
            return
        }
        guard let device = devices.first(where: { CommandLine.arguments.count < 3 || $0.uniqueID == CommandLine.arguments[2] }) else {
            fail("未找到 USB iPhone 屏幕，请解锁手机、确认 USB 数据线连接，并在手机上信任此电脑。")
        }
        let auth = AVCaptureDevice.authorizationStatus(for: .video)
        if auth == .notDetermined {
            var complete = false
            var granted = false
            AVCaptureDevice.requestAccess(for: .video) { value in
                DispatchQueue.main.async { granted = value; complete = true }
            }
            while !complete { RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.1)) }
            if !granted { fail("请在接入 iPhone 的 Mac 上允许 Midscene iOS AirLink Capture 使用相机。") }
        } else if auth != .authorized {
            fail("请在 Mac 的系统设置 → 隐私与安全性 → 相机中允许 Midscene iOS AirLink Capture。")
        }
        let session = AVCaptureSession()
        let input: AVCaptureDeviceInput
        do { input = try AVCaptureDeviceInput(device: device) }
        catch { fail("无法打开 iPhone 屏幕：\(error)") }
        guard session.canAddInput(input) else { fail("无法添加 USB 屏幕输入") }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        let writer = FrameWriter(destination: captureOutput ?? .standardOutput)
        guard session.canAddOutput(output) else { fail("无法添加视频输出") }
        session.addOutput(output)
        let observer = NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification,
                                                               object: session, queue: nil) { notification in
            let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
            fail(error?.localizedDescription ?? "USB capture session failed.")
        }
        session.startRunning()
        guard session.isRunning else { fail("USB capture session could not start.") }
        if let output = captureOutput {
            do { try output.write(contentsOf: Data("ready\n".utf8)) }
            catch { exit(1) }
        }
        output.setSampleBufferDelegate(writer, queue: DispatchQueue(label: "midscene.usb.frames"))
        withExtendedLifetime((session, writer, observer)) { RunLoop.main.run() }
    }
}
