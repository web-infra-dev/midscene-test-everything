import AppKit
import AVFoundation
import CoreImage
import CoreMedia
import Darwin
import Foundation
import ImageIO

struct DeviceInfo: Encodable {
    let uid: String
    let name: String
    let deviceType: String
    let formats: [CaptureMode]
    let usbLocationId: UInt32?
}

struct CaptureMode: Encodable {
    let width: Int32
    let height: Int32
    let minFps: Double
    let maxFps: Double
}

struct UVCDeviceInfo: Decodable {
    let locationId: UInt32
    let vendorId: UInt32
    let productId: UInt32
    let name: String
    let serialNumber: String
}

struct UVCDeviceListResponse: Decodable {
    let ok: Bool
    let devices: [UVCDeviceInfo]?
    let error: String?
}

struct ControlRequest: Decodable {
    let id: String
    let action: String
    let property: String?
    let value: Double?
    let mode: String?
}

struct ControlValue: Codable {
    let property: String
    let value: Double
    let mode: String
    let min: Double
    let max: Double
    let step: Double
    let defaultValue: Double
    let supportsAuto: Bool
    let supportsManual: Bool

    enum CodingKeys: String, CodingKey {
        case property, value, mode, min, max, step, supportsAuto, supportsManual
        case defaultValue = "default"
    }
}

struct ControlResponse: Encodable {
    let id: String
    let ok: Bool
    let controls: [String: ControlValue]?
    let error: String?
}

struct UVCControlResponse: Decodable {
    let ok: Bool
    let controls: [String: ControlValue]?
    let error: String?
}

func cameras() -> [AVCaptureDevice] {
    AVCaptureDevice.devices(for: .video)
}

var frameOutput = FileHandle.standardOutput
var appConnection: FileHandle?
var appDisconnect: DispatchSourceRead?
var appReady = false

func connectToService(_ path: String) {
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { fail("Cannot create camera connection") }
    var address = sockaddr_un()
    let bytes = Array(path.utf8CString)
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
        fail("Camera socket path is too long")
    }
    address.sun_family = sa_family_t(AF_UNIX)
    withUnsafeMutableBytes(of: &address.sun_path) { target in
        bytes.withUnsafeBytes { target.copyBytes(from: $0) }
    }
    let status = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard status == 0 else { fail("Cannot connect to the device service") }
    signal(SIGPIPE, SIG_IGN)
    let connection = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    appConnection = connection
    frameOutput = connection
    let disconnect = DispatchSource.makeReadSource(fileDescriptor: fd, queue: .global())
    disconnect.setEventHandler { exit(0) }
    appDisconnect = disconnect
    disconnect.resume()
}

func authorizeCamera() {
    _ = NSApplication.shared
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                if !granted { fail("Camera access was denied. Allow Midscene Camera in System Settings > Privacy & Security > Camera.") }
                CFRunLoopStop(CFRunLoopGetMain())
            }
        }
        CFRunLoopRun()
    case .denied, .restricted:
        fail("Camera access is blocked. Allow Midscene Camera in System Settings > Privacy & Security > Camera.")
    @unknown default:
        fail("Unable to determine camera authorization")
    }
}

func fail(_ message: String) -> Never {
    if let connection = appConnection, !appReady {
        let line = message.replacingOccurrences(of: "\n", with: " ")
        try? connection.write(contentsOf: Data(("error " + line + "\n").utf8))
    }
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func takeNativeString(_ pointer: UnsafeMutablePointer<CChar>) -> String {
    defer { MidsceneUVCFreeString(pointer) }
    return String(cString: pointer)
}

func uvcDevices() -> [UVCDeviceInfo] {
    guard let pointer = MidsceneUVCDeviceListJSON() else { return [] }
    let data = Data(takeNativeString(pointer).utf8)
    do {
        let response = try JSONDecoder().decode(
            UVCDeviceListResponse.self,
            from: data
        )
        return response.ok ? response.devices ?? [] : []
    } catch {
        return []
    }
}

func normalizedHardwareName(_ value: String) -> String {
    let scalars = value
        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        .unicodeScalars
        .filter(CharacterSet.alphanumerics.contains)
    return String(String.UnicodeScalarView(scalars))
}

func matchingUVCDevice(
    for camera: AVCaptureDevice,
    devices: [UVCDeviceInfo]
) -> UVCDeviceInfo? {
    let uid = camera.uniqueID.lowercased()
    let serialMatches = devices.filter {
        $0.serialNumber.count >= 4 &&
            uid.contains($0.serialNumber.lowercased())
    }
    if serialMatches.count == 1 { return serialMatches[0] }

    let deviceName = normalizedHardwareName(camera.localizedName)
    let named = devices.filter {
        normalizedHardwareName($0.name) == deviceName
    }
    if named.count == 1 { return named[0] }

    let containsName = devices.filter {
        let hardwareName = normalizedHardwareName($0.name)
        return hardwareName.count >= 4 &&
            (hardwareName.contains(deviceName) || deviceName.contains(hardwareName))
    }
    if containsName.count == 1 { return containsName[0] }

    if serialMatches.count == 1 { return serialMatches[0] }
    if devices.count == 1 { return devices[0] }
    return nil
}

func writeControlResponse(_ response: ControlResponse) {
    do {
        let data = try JSONEncoder().encode(response)
        var line = data
        line.append(0x0A)
        FileHandle.standardOutput.write(line)
    } catch {
        fail("Failed to encode camera control response: \(error)")
    }
}

func queryUVCControls(
    _ device: UnsafeMutableRawPointer
) throws -> UVCControlResponse {
    guard let pointer = MidsceneUVCDeviceQueryJSON(device) else {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "UVC query returned no response"]
        )
    }
    let data = Data(takeNativeString(pointer).utf8)
    let response = try JSONDecoder().decode(UVCControlResponse.self, from: data)
    if !response.ok {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey:
                response.error ?? "UVC camera query failed"]
        )
    }
    return response
}

func setUVCControl(
    _ device: UnsafeMutableRawPointer,
    property: String,
    value: Double,
    mode: String
) throws {
    guard let pointer = MidsceneUVCDeviceSetJSON(
        device,
        property,
        value,
        mode
    ) else {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "UVC set returned no response"]
        )
    }
    let data = Data(takeNativeString(pointer).utf8)
    let response = try JSONDecoder().decode(UVCControlResponse.self, from: data)
    if !response.ok {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey:
                response.error ?? "UVC camera command failed"]
        )
    }
}

func openUVCControl(_ target: String) -> UnsafeMutableRawPointer? {
    if target.hasPrefix("uvc:"),
       let location = UInt32(target.dropFirst(4)) {
        return MidsceneUVCDeviceCreateForLocation(location)
    }
    guard let camera = cameras().first(where: { $0.uniqueID == target }),
          let match = matchingUVCDevice(for: camera, devices: uvcDevices())
    else { return nil }
    return MidsceneUVCDeviceCreateForLocation(match.locationId)
}

func runControl(_ target: String) -> Never {
    guard let device = openUVCControl(target) else {
        fail(
            "No standard UVC controls found for \(target). " +
            "Built-in and Continuity cameras do not expose USB UVC controls."
        )
    }
    defer { MidsceneUVCDeviceDestroy(device) }

    writeControlResponse(
        ControlResponse(id: "ready", ok: true, controls: nil, error: nil)
    )
    while let line = readLine() {
        let request: ControlRequest
        do {
            guard let data = line.data(using: .utf8) else {
                throw NSError(
                    domain: "MidsceneCameraControl",
                    code: 5,
                    userInfo: [NSLocalizedDescriptionKey:
                        "Camera control request is not UTF-8"]
                )
            }
            request = try JSONDecoder().decode(ControlRequest.self, from: data)
        } catch {
            writeControlResponse(
                ControlResponse(
                    id: "",
                    ok: false,
                    controls: nil,
                    error: error.localizedDescription
                )
            )
            continue
        }

        do {
            switch request.action {
            case "query":
                let response = try queryUVCControls(device)
                writeControlResponse(
                    ControlResponse(
                        id: request.id,
                        ok: true,
                        controls: response.controls,
                        error: nil
                    )
                )
            case "set":
                guard let property = request.property,
                      let value = request.value,
                      let mode = request.mode,
                      mode == "auto" || mode == "manual" else {
                    throw NSError(
                        domain: "MidsceneCameraControl",
                        code: 6,
                        userInfo: [NSLocalizedDescriptionKey:
                            "Camera control value is invalid"]
                    )
                }
                try setUVCControl(
                    device,
                    property: property,
                    value: value,
                    mode: mode
                )
                writeControlResponse(
                    ControlResponse(
                        id: request.id,
                        ok: true,
                        controls: nil,
                        error: nil
                    )
                )
            case "shutdown":
                writeControlResponse(
                    ControlResponse(
                        id: request.id,
                        ok: true,
                        controls: nil,
                        error: nil
                    )
                )
                exit(0)
            default:
                throw NSError(
                    domain: "MidsceneCameraControl",
                    code: 7,
                    userInfo: [NSLocalizedDescriptionKey:
                        "Unknown camera control action: \(request.action)"]
                )
            }
        } catch {
            writeControlResponse(
                ControlResponse(
                    id: request.id,
                    ok: false,
                    controls: nil,
                    error: error.localizedDescription
                )
            )
        }
    }
    exit(0)
}

func captureFrameDuration(fps: Double, minDuration: CMTime, maxDuration: CMTime) -> CMTime {
    // Advertised integer FPS can represent a slightly different hardware rate.
    // Preserve the exact range endpoints, especially for fixed-rate formats.
    let requested = CMTime(seconds: 1.0 / fps, preferredTimescale: 600_000_000)
    if CMTimeCompare(requested, minDuration) < 0 { return minDuration }
    if CMTimeCompare(requested, maxDuration) > 0 { return maxDuration }
    return requested
}

func supportsCaptureFrameRate(_ fps: Double, minFps: Double, maxFps: Double) -> Bool {
    // Accept nominal 30/60/120 FPS for exact 29.97/59.94/119.88 FPS rates.
    minFps - 0.15 <= fps && fps <= maxFps + 0.15
}

func captureFormat(
    for device: AVCaptureDevice,
    width: Int32,
    height: Int32,
    fps: Double
) -> (AVCaptureDevice.Format, AVFrameRateRange)? {
    let matches = device.formats.filter { format in
        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        return dimensions.width == width && dimensions.height == height &&
            format.videoSupportedFrameRateRanges.contains { range in
                supportsCaptureFrameRate(fps, minFps: range.minFrameRate, maxFps: range.maxFrameRate)
            }
    }
    // C922 exposes 1080p30 as 420v and 1080p5 as yuvs. Select the
    // actual device format, not only the output CVPixelBuffer format.
    guard let format = matches.first(where: {
        CMFormatDescriptionGetMediaSubType($0.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    }) ?? matches.first else { return nil }
    guard let range = format.videoSupportedFrameRateRanges.first(where: {
        supportsCaptureFrameRate(fps, minFps: $0.minFrameRate, maxFps: $0.maxFrameRate)
    }) else { return nil }
    return (format, range)
}

final class JpegReceiver: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let context = CIContext()
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private let horizontalFlip: Bool
    private let verticalFlip: Bool
    private let output: FileHandle

    init(horizontalFlip: Bool, verticalFlip: Bool, output: FileHandle) {
        self.horizontalFlip = horizontalFlip
        self.verticalFlip = verticalFlip
        self.output = output
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            fail("Camera delivered a frame without an image buffer")
        }
        var image = CIImage(cvPixelBuffer: buffer)
        if horizontalFlip && verticalFlip {
            image = image.oriented(.down)
        } else if horizontalFlip {
            image = image.oriented(.upMirrored)
        } else if verticalFlip {
            image = image.oriented(.downMirrored)
        }
        guard let jpeg = context.jpegRepresentation(
            of: image,
            colorSpace: colorSpace,
            options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.85]
        ) else { fail("Failed to encode camera frame") }
        do {
            try self.output.write(contentsOf: jpeg)
        } catch {
            fail("Failed to send camera frame: \(error)")
        }
    }
}

let args = CommandLine.arguments
if args.count == 3 && args[1] == "control" {
    runControl(args[2])
}
if args.count == 2 && args[1] == "list" {
    let uvc = uvcDevices()
    let devices = cameras().map { device in
        let formats = device.formats.flatMap { format -> [CaptureMode] in
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return format.videoSupportedFrameRateRanges.map { range in
                CaptureMode(width: dimensions.width, height: dimensions.height,
                            minFps: range.minFrameRate, maxFps: range.maxFrameRate)
            }
        }
        return DeviceInfo(
            uid: device.uniqueID,
            name: device.localizedName,
            deviceType: device.deviceType.rawValue,
            formats: formats,
            usbLocationId: matchingUVCDevice(for: device, devices: uvc)?.locationId
        )
    }
    do {
        let data = try JSONEncoder().encode(devices)
        FileHandle.standardOutput.write(data)
        exit(0)
    } catch {
        fail("Failed to enumerate cameras: \(error)")
    }
}

let appCapture = args.count == 10 && args[8] == "--socket"
guard (args.count == 8 || appCapture), args[1] == "capture" else {
    fail("Usage: macos-camera list | control <uid-or-uvc-location> | capture <uid> <width> <height> <fps> <horizontalFlip> <verticalFlip>")
}
if appCapture {
    connectToService(args[9])
    authorizeCamera()
}
let uid = args[2]
guard let width = Int32(args[3]), let height = Int32(args[4]),
      let fps = Double(args[5]), fps > 0,
      let horizontalFlip = Bool(args[6]), let verticalFlip = Bool(args[7]) else {
    fail("Invalid capture arguments")
}
guard let device = cameras().first(where: { $0.uniqueID == uid }) else {
    fail("Camera UID not found: \(uid)")
}
guard let (format, range) = captureFormat(for: device, width: width, height: height, fps: fps) else {
    fail("Camera \(device.localizedName) does not support \(width)x\(height)@\(fps)")
}

do {
    let session = AVCaptureSession()
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else { fail("Cannot add camera input") }
    session.addInput(input)

    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
        kCVPixelBufferPixelFormatTypeKey as String:
            kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    ]
    let receiver = JpegReceiver(horizontalFlip: horizontalFlip, verticalFlip: verticalFlip, output: frameOutput)
    let queue = DispatchQueue(label: "midscene.robot-vision.camera")
    guard session.canAddOutput(output) else { fail("Cannot add camera output") }
    session.addOutput(output)

    session.startRunning()
    guard session.isRunning else { fail("Camera session did not start") }
    // Starting the session may reset the frame duration to its preferred
    // default (24 FPS on C922), so apply the exact mode only after startRunning.
    try device.lockForConfiguration()
    device.activeFormat = format
    let duration = captureFrameDuration(
        fps: fps, minDuration: range.minFrameDuration, maxDuration: range.maxFrameDuration
    )
    device.activeVideoMinFrameDuration = duration
    device.activeVideoMaxFrameDuration = duration
    device.unlockForConfiguration()
    if appCapture {
        try frameOutput.write(contentsOf: Data("ready\n".utf8))
        appReady = true
    }
    // Drop any frames from the session's temporary start-up format.
    output.setSampleBufferDelegate(receiver, queue: queue)
    RunLoop.current.run()
} catch {
    fail("Camera capture failed: \(error)")
}
