import AVFoundation
import CoreImage
import CoreMedia
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

func fail(_ message: String) -> Never {
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

    init(horizontalFlip: Bool, verticalFlip: Bool) {
        self.horizontalFlip = horizontalFlip
        self.verticalFlip = verticalFlip
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
        FileHandle.standardOutput.write(jpeg)
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

guard args.count == 8, args[1] == "capture" else {
    fail("Usage: macos-camera list | capture <uid> <width> <height> <fps> <horizontalFlip> <verticalFlip>")
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
    let receiver = JpegReceiver(horizontalFlip: horizontalFlip, verticalFlip: verticalFlip)
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
    // Drop any frames from the session's temporary start-up format.
    output.setSampleBufferDelegate(receiver, queue: queue)
    RunLoop.current.run()
} catch {
    fail("Camera capture failed: \(error)")
}
