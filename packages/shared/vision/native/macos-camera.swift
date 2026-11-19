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
}

struct CaptureMode: Encodable {
    let width: Int32
    let height: Int32
    let minFps: Double
    let maxFps: Double
}

struct ControlRequest: Decodable {
    let id: String
    let action: String
    let property: String?
    let value: Double?
    let mode: String?
}

struct ControlValue: Encodable {
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

final class ControlCompletionState {
    private let lock = NSLock()
    private var finished = false

    func finish(_ action: () -> Void) {
        lock.lock()
        if finished {
            lock.unlock()
            return
        }
        finished = true
        lock.unlock()
        action()
    }
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

func clampControl(_ value: Double, _ min: Double, _ max: Double) -> Double {
    Swift.max(min, Swift.min(max, value))
}

func controlMode(manual: Bool) -> String {
    manual ? "manual" : "auto"
}

func controlError(_ error: CMError) -> Error? {
    guard error.rawValue != 0 else { return nil }
    return NSError(
        domain: NSOSStatusErrorDomain,
        code: Int(error.rawValue),
        userInfo: [
            NSLocalizedDescriptionKey:
                "AVFoundation camera control failed with OSStatus \(error.rawValue)"
        ]
    )
}

func exposureBounds(_ device: AVCaptureDevice) -> (min: Double, max: Double) {
    let advertisedMin = CMTimeGetSeconds(device.activeFormat.minExposureDuration)
    let advertisedMax = CMTimeGetSeconds(device.activeFormat.maxExposureDuration)
    let minSeconds = advertisedMin.isFinite && advertisedMin > 0
        ? advertisedMin
        : 0.000_001
    let maxSeconds = advertisedMax.isFinite && advertisedMax >= minSeconds
        ? advertisedMax
        : 1
    return (
        min: floor(log2(minSeconds)),
        max: ceil(log2(maxSeconds))
    )
}

func exposureValue(_ duration: CMTime) -> Double {
    let seconds = CMTimeGetSeconds(duration)
    return log2(seconds.isFinite && seconds > 0 ? seconds : 0.000_001)
}

func supportsAutoExposure(_ device: AVCaptureDevice) -> Bool {
    device.isExposureModeSupported(.continuousAutoExposure) ||
        device.isExposureModeSupported(.autoExpose)
}

func readFocus(_ device: AVCaptureDevice) -> ControlValue? {
    let supportsManual = device.isLockingFocusWithCustomLensPositionSupported
    let supportsAuto = device.isFocusModeSupported(.continuousAutoFocus) ||
        device.isFocusModeSupported(.autoFocus)
    guard supportsManual || supportsAuto else { return nil }
    let value = Double(device.lensPosition)
    return ControlValue(
        property: "focus",
        value: value,
        mode: controlMode(manual: device.focusMode == .locked),
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: value,
        supportsAuto: supportsAuto,
        supportsManual: supportsManual
    )
}

func readExposure(_ device: AVCaptureDevice) -> ControlValue? {
    let supportsManual = device.isExposureModeSupported(.custom)
    let supportsAuto = supportsAutoExposure(device)
    guard supportsManual || supportsAuto else { return nil }
    let bounds = exposureBounds(device)
    let value = clampControl(
        exposureValue(device.exposureDuration),
        bounds.min,
        bounds.max
    )
    return ControlValue(
        property: "exposure",
        value: value,
        mode: controlMode(manual: device.exposureMode == .custom),
        min: bounds.min,
        max: bounds.max,
        step: 1,
        defaultValue: value,
        supportsAuto: supportsAuto,
        supportsManual: supportsManual
    )
}

func readGain(_ device: AVCaptureDevice) -> ControlValue? {
    let supportsManual = device.isExposureModeSupported(.custom)
    let supportsAuto = supportsAutoExposure(device)
    let minISO = Double(device.activeFormat.minISO)
    let maxISO = Double(device.activeFormat.maxISO)
    guard supportsManual || supportsAuto,
          minISO.isFinite,
          maxISO.isFinite,
          maxISO >= minISO,
          maxISO > 0 else { return nil }
    let value = clampControl(Double(device.iso), minISO, maxISO)
    return ControlValue(
        property: "gain",
        value: value,
        mode: controlMode(manual: device.exposureMode == .custom),
        min: minISO,
        max: maxISO,
        step: 1,
        defaultValue: value,
        supportsAuto: supportsAuto,
        supportsManual: supportsManual
    )
}

func readWhiteBalance(_ device: AVCaptureDevice) -> ControlValue? {
    let supportsManual = device.isLockingWhiteBalanceWithCustomDeviceGainsSupported
    let supportsAuto = device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) ||
        device.isWhiteBalanceModeSupported(.autoWhiteBalance)
    guard supportsManual || supportsAuto else { return nil }
    let temperature = device.temperatureAndTintValues(
        for: device.deviceWhiteBalanceGains
    ).temperature
    let value = clampControl(Double(temperature), 2_000, 10_000)
    return ControlValue(
        property: "whiteBalance",
        value: value,
        mode: controlMode(manual: device.whiteBalanceMode == .locked),
        min: 2_000,
        max: 10_000,
        step: 100,
        defaultValue: value,
        supportsAuto: supportsAuto,
        supportsManual: supportsManual
    )
}

func readControls(_ device: AVCaptureDevice) -> [String: ControlValue] {
    var controls: [String: ControlValue] = [:]
    if let focus = readFocus(device) { controls["focus"] = focus }
    if let exposure = readExposure(device) { controls["exposure"] = exposure }
    if let gain = readGain(device) { controls["gain"] = gain }
    if let whiteBalance = readWhiteBalance(device) {
        controls["whiteBalance"] = whiteBalance
    }
    return controls
}

func waitForControl(_ operation: (@escaping (Error?) -> Void) -> Void) throws {
    let semaphore = DispatchSemaphore(value: 0)
    var operationError: Error?
    operation { error in
        operationError = error
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 3) == .success else {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Camera control timed out"]
        )
    }
    if let operationError { throw operationError }
}

func runLockedControl(
    _ device: AVCaptureDevice,
    operation: (@escaping (Error?) -> Void) -> Void
) throws {
    let state = ControlCompletionState()
    do {
        try waitForControl { completion in
            operation { error in
                state.finish {
                    device.unlockForConfiguration()
                    completion(error)
                }
            }
        }
    } catch {
        state.finish {
            device.unlockForConfiguration()
        }
        throw error
    }
}

func setAutoExposure(_ device: AVCaptureDevice) {
    if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
    } else {
        device.exposureMode = .autoExpose
    }
}

func setFocus(_ device: AVCaptureDevice, value: Double, mode: String) throws {
    try device.lockForConfiguration()
    if mode == "auto" {
        defer { device.unlockForConfiguration() }
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        } else if device.isFocusModeSupported(.autoFocus) {
            device.focusMode = .autoFocus
        } else {
            throw NSError(
                domain: "MidsceneCameraControl",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Automatic focus is unavailable"]
            )
        }
        return
    }
    guard device.isLockingFocusWithCustomLensPositionSupported else {
        device.unlockForConfiguration()
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Manual focus is unavailable"]
        )
    }
    let lensPosition = Float(clampControl(value, 0, 1))
    try runLockedControl(device) { completion in
        device.setFocusModeLocked(
            lensPosition: lensPosition,
            completionHandler: { completion(controlError($0)) }
        )
    }
}

func lockedExposureDuration(_ device: AVCaptureDevice, value: Double) -> CMTime {
    let bounds = exposureBounds(device)
    let seconds = clampControl(pow(2, value), pow(2, bounds.min), pow(2, bounds.max))
    return CMTime(seconds: seconds, preferredTimescale: 1_000_000_000)
}

func setExposure(
    _ device: AVCaptureDevice,
    value: Double,
    mode: String,
    iso: Float? = nil
) throws {
    try device.lockForConfiguration()
    if mode == "auto" {
        setAutoExposure(device)
        device.unlockForConfiguration()
        return
    }
    guard device.isExposureModeSupported(.custom) else {
        device.unlockForConfiguration()
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "Manual exposure is unavailable"]
        )
    }
    let duration = lockedExposureDuration(device, value: value)
    let selectedISO = Swift.max(
        device.activeFormat.minISO,
        Swift.min(device.activeFormat.maxISO, iso ?? device.iso)
    )
    try runLockedControl(device) { completion in
        device.setExposureModeCustom(
            duration: duration,
            iso: selectedISO,
            completionHandler: { completion(controlError($0)) }
        )
    }
}

func setGain(_ device: AVCaptureDevice, value: Double, mode: String) throws {
    try device.lockForConfiguration()
    if mode == "auto" {
        setAutoExposure(device)
        device.unlockForConfiguration()
        return
    }
    guard device.isExposureModeSupported(.custom) else {
        device.unlockForConfiguration()
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 6,
            userInfo: [NSLocalizedDescriptionKey: "Manual gain is unavailable"]
        )
    }
    let iso = Float(clampControl(
        value,
        Double(device.activeFormat.minISO),
        Double(device.activeFormat.maxISO)
    ))
    let duration = device.exposureDuration
    try runLockedControl(device) { completion in
        device.setExposureModeCustom(
            duration: duration,
            iso: iso,
            completionHandler: { completion(controlError($0)) }
        )
    }
}

func normalizedWhiteBalanceGains(
    _ gains: AVCaptureDevice.WhiteBalanceGains,
    maximum: Float
) -> AVCaptureDevice.WhiteBalanceGains {
    AVCaptureDevice.WhiteBalanceGains(
        redGain: Swift.max(1, Swift.min(maximum, gains.redGain)),
        greenGain: Swift.max(1, Swift.min(maximum, gains.greenGain)),
        blueGain: Swift.max(1, Swift.min(maximum, gains.blueGain))
    )
}

func setWhiteBalance(
    _ device: AVCaptureDevice,
    value: Double,
    mode: String
) throws {
    try device.lockForConfiguration()
    if mode == "auto" {
        defer { device.unlockForConfiguration() }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
            device.whiteBalanceMode = .continuousAutoWhiteBalance
        } else if device.isWhiteBalanceModeSupported(.autoWhiteBalance) {
            device.whiteBalanceMode = .autoWhiteBalance
        } else {
            throw NSError(
                domain: "MidsceneCameraControl",
                code: 7,
                userInfo: [NSLocalizedDescriptionKey: "Automatic white balance is unavailable"]
            )
        }
        return
    }
    guard device.isLockingWhiteBalanceWithCustomDeviceGainsSupported else {
        device.unlockForConfiguration()
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 8,
            userInfo: [NSLocalizedDescriptionKey: "Manual white balance is unavailable"]
        )
    }
    let current = device.temperatureAndTintValues(
        for: device.deviceWhiteBalanceGains
    )
    let target = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(
        temperature: Float(clampControl(value, 2_000, 10_000)),
        tint: current.tint
    )
    let gains = normalizedWhiteBalanceGains(
        device.deviceWhiteBalanceGains(for: target),
        maximum: device.maxWhiteBalanceGain
    )
    try runLockedControl(device) { completion in
        device.setWhiteBalanceModeLocked(
            with: gains,
            completionHandler: { completion(controlError($0)) }
        )
    }
}

func setControl(_ device: AVCaptureDevice, request: ControlRequest) throws {
    guard let property = request.property,
          let value = request.value,
          let mode = request.mode,
          mode == "auto" || mode == "manual" else {
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 9,
            userInfo: [NSLocalizedDescriptionKey: "Camera control value is invalid"]
        )
    }
    switch property {
    case "focus":
        try setFocus(device, value: value, mode: mode)
    case "exposure":
        try setExposure(device, value: value, mode: mode)
    case "gain":
        try setGain(device, value: value, mode: mode)
    case "whiteBalance":
        try setWhiteBalance(device, value: value, mode: mode)
    default:
        throw NSError(
            domain: "MidsceneCameraControl",
            code: 10,
            userInfo: [NSLocalizedDescriptionKey: "Unsupported camera property: \(property)"]
        )
    }
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

func runControl(_ uid: String) -> Never {
    authorizeCamera()
    guard let device = cameras().first(where: { $0.uniqueID == uid }) else {
        fail("Camera UID not found: \(uid)")
    }
    writeControlResponse(
        ControlResponse(id: "ready", ok: true, controls: nil, error: nil)
    )
    while let line = readLine() {
        let request: ControlRequest
        do {
            guard let data = line.data(using: .utf8) else {
                throw NSError(
                    domain: "MidsceneCameraControl",
                    code: 11,
                    userInfo: [NSLocalizedDescriptionKey: "Camera control request is not UTF-8"]
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
                writeControlResponse(
                    ControlResponse(
                        id: request.id,
                        ok: true,
                        controls: readControls(device),
                        error: nil
                    )
                )
            case "set":
                try setControl(device, request: request)
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
                    code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "Unknown camera control action: \(request.action)"]
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
    let devices = cameras().map { device in
        let formats = device.formats.flatMap { format -> [CaptureMode] in
            let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return format.videoSupportedFrameRateRanges.map { range in
                CaptureMode(width: dimensions.width, height: dimensions.height,
                            minFps: range.minFrameRate, maxFps: range.maxFrameRate)
            }
        }
        return DeviceInfo(uid: device.uniqueID, name: device.localizedName,
                          deviceType: device.deviceType.rawValue, formats: formats)
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
    fail("Usage: macos-camera list | control <uid> | capture <uid> <width> <height> <fps> <horizontalFlip> <verticalFlip>")
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
