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
    fail("Usage: macos-camera list | capture <uid> <width> <height> <fps> <horizontalFlip> <verticalFlip>")
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
