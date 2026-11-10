import AVFoundation
import CoreImage
import CoreMediaIO
import Foundation
import ImageIO
import UniformTypeIdentifiers

func note(_ text: String) { FileHandle.standardError.write(Data((text + "\n").utf8)) }
func fail(_ text: String) -> Never { note("USB error: " + text); exit(1) }

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
        FileHandle.standardOutput.write(data as Data)
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
            if !granted { fail("相机访问未获授权，请在系统设置的隐私与安全性中允许当前启动程序访问相机。") }
        } else if auth != .authorized {
            fail("相机访问已被拒绝，请在系统设置 → 隐私与安全性 → 相机中检查权限。")
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
        let writer = FrameWriter()
        output.setSampleBufferDelegate(writer, queue: DispatchQueue(label: "midscene.usb.frames"))
        guard session.canAddOutput(output) else { fail("无法添加视频输出") }
        session.addOutput(output)
        let observer = NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification,
                                                               object: session, queue: nil) { notification in
            note("USB capture error: \(notification.userInfo ?? [:])")
        }
        note("USB capturing: \(device.localizedName)")
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
        withExtendedLifetime((writer, observer)) { RunLoop.main.run() }
    }
}
