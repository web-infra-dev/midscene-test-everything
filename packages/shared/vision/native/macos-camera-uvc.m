// IOKit interface discovery and UVC request sequencing are adapted from
// jtfrey/uvc-util. See macos-camera-uvc-LICENSE.
#import <Foundation/Foundation.h>

#include <IOKit/IOKitLib.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/usb/IOUSBLib.h>
#include <libkern/OSByteOrder.h>
#include <stdlib.h>
#include <string.h>

#include "macos-camera-uvc.h"

enum {
    UVC_CS_INTERFACE = 0x24,
    UVC_VC_HEADER = 0x01,
    UVC_VC_INPUT_TERMINAL = 0x02,
    UVC_VC_PROCESSING_UNIT = 0x05,
};

enum {
    UVC_GET_CUR = 0x81,
    UVC_GET_MIN = 0x82,
    UVC_GET_MAX = 0x83,
    UVC_GET_RES = 0x84,
    UVC_GET_DEF = 0x87,
    UVC_GET_INFO = 0x86,
    UVC_SET_CUR = 0x01,
};

enum {
    UVC_CT_AE_MODE = 0x02,
    UVC_CT_EXPOSURE_TIME_ABSOLUTE = 0x04,
    UVC_CT_FOCUS_ABSOLUTE = 0x06,
    UVC_CT_FOCUS_AUTO = 0x08,
};

enum {
    UVC_PU_GAIN = 0x04,
    UVC_PU_WHITE_BALANCE_TEMPERATURE = 0x0a,
    UVC_PU_WHITE_BALANCE_TEMPERATURE_AUTO = 0x0b,
};

typedef struct {
    BOOL available;
    BOOL supportsGet;
    BOOL supportsSet;
    uint64_t current;
    uint64_t minimum;
    uint64_t maximum;
    uint64_t resolution;
    uint64_t defaultValue;
    size_t size;
} UVCMeta;

static char *CopyJSON(id value) {
    NSError *error = nil;
    NSData *data = [NSJSONSerialization dataWithJSONObject:value
                                                   options:0
                                                     error:&error];
    if (!data) {
        NSString *fallback = [NSString stringWithFormat:
            @"{\"ok\":false,\"error\":\"%@\"}",
            [error localizedDescription] ?: @"JSON encoding failed"];
        return strdup([fallback UTF8String]);
    }
    NSString *json = [[NSString alloc] initWithData:data
                                           encoding:NSUTF8StringEncoding];
    return strdup(json.UTF8String);
}

static id ErrorJSON(NSString *message) {
    return @{
        @"ok": @NO,
        @"error": message ?: @"UVC camera control failed",
    };
}

static uint64_t ReadUnsigned(const uint8_t *bytes, size_t size) {
    switch (size) {
        case 1:
            return bytes[0];
        case 2:
            return OSReadLittleInt16(bytes, 0);
        case 4:
            return OSReadLittleInt32(bytes, 0);
        default:
            return 0;
    }
}

static void WriteUnsigned(uint8_t *bytes, size_t size, uint64_t value) {
    switch (size) {
        case 1:
            bytes[0] = (uint8_t)value;
            break;
        case 2:
            OSWriteLittleInt16(bytes, 0, (uint16_t)value);
            break;
        case 4:
            OSWriteLittleInt32(bytes, 0, (uint32_t)value);
            break;
    }
}

static NSString *StringProperty(
    io_service_t service,
    CFStringRef key
) {
    CFTypeRef value = IORegistryEntryCreateCFProperty(
        service,
        key,
        kCFAllocatorDefault,
        0
    );
    if (!value) return nil;
    NSString *string =
        CFGetTypeID(value) == CFStringGetTypeID()
            ? [(__bridge NSString *)value copy]
            : nil;
    CFRelease(value);
    return string;
}

static NSNumber *NumberProperty(
    io_service_t service,
    CFStringRef key
) {
    CFTypeRef value = IORegistryEntryCreateCFProperty(
        service,
        key,
        kCFAllocatorDefault,
        0
    );
    if (!value) return nil;
    NSNumber *number =
        CFGetTypeID(value) == CFNumberGetTypeID()
            ? [(__bridge NSNumber *)value copy]
            : nil;
    CFRelease(value);
    return number;
}

static io_service_t USBServiceForLocation(uint32_t locationId) {
    CFMutableDictionaryRef matching = IOServiceMatching(kIOUSBDeviceClassName);
    if (!matching) return 0;
    io_iterator_t iterator = 0;
    if (IOServiceGetMatchingServices(
            kIOMainPortDefault,
            matching,
            &iterator
        ) != KERN_SUCCESS) {
        return 0;
    }

    io_service_t found = 0;
    io_service_t service = 0;
    while ((service = IOIteratorNext(iterator))) {
        NSNumber *candidate = NumberProperty(
            service,
            CFSTR(kUSBDevicePropertyLocationID)
        );
        if (candidate.unsignedIntValue == locationId) {
            found = service;
            break;
        }
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator);
    return found;
}

@interface MidsceneUVCDevice : NSObject {
    IOUSBInterfaceInterface220 **_interface;
    BOOL _interfaceOpen;
    BOOL _ownsInterface;
}

@property(nonatomic, assign) uint32_t locationId;
@property(nonatomic, assign) uint16_t vendorId;
@property(nonatomic, assign) uint16_t productId;
@property(nonatomic, copy) NSString *name;
@property(nonatomic, copy, nullable) NSString *serialNumber;
@property(nonatomic, assign) uint8_t videoInterfaceIndex;
@property(nonatomic, assign) uint8_t inputTerminalId;
@property(nonatomic, assign) uint8_t processingUnitId;

- (nullable instancetype)initWithService:(io_service_t)service
                             locationId:(uint32_t)locationId
                                  error:(NSError **)error;
- (nullable NSArray<NSDictionary *> *)queryControls:(NSError **)error;
- (BOOL)setProperty:(NSString *)property
              value:(double)value
               mode:(NSString *)mode
              error:(NSError **)error;

@end

@interface MidsceneUVCDevice ()
- (BOOL)connectInterfaceToService:(io_service_t)service
                            error:(NSError **)error;
- (void)readUnitIds;
- (void)closeInterface;
- (BOOL)controlRequest:(IOUSBDevRequest *)request error:(NSError **)error;
- (BOOL)getData:(void *)data
         length:(uint16_t)length
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error;
- (BOOL)getData:(void *)data
         length:(uint16_t)length
        request:(uint8_t)requestCode
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error;
- (BOOL)setData:(const void *)data
         length:(uint16_t)length
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error;
- (BOOL)loadMeta:(UVCMeta *)meta
        selector:(uint8_t)selector
          unitId:(uint8_t)unitId
            size:(size_t)size;
@end

@implementation MidsceneUVCDevice

- (instancetype)initWithService:(io_service_t)service
                     locationId:(uint32_t)locationId
                          error:(NSError **)error {
    self = [super init];
    if (!self) return nil;

    _locationId = locationId;
    _vendorId = NumberProperty(service, CFSTR(kUSBVendorID)).unsignedShortValue;
    _productId = NumberProperty(service, CFSTR(kUSBProductID)).unsignedShortValue;
    _name = StringProperty(service, CFSTR("USB Product Name"));
    if (!_name) {
        io_name_t registryName = {0};
        if (IORegistryEntryGetName(service, registryName) == KERN_SUCCESS) {
            _name = [NSString stringWithUTF8String:registryName];
        }
    }
    if (!_name) _name = @"USB Video Device";
    _serialNumber = StringProperty(service, CFSTR("USB Serial Number"));
    _inputTerminalId = 1;
    _processingUnitId = 2;

    if (![self connectInterfaceToService:service error:error]) {
        [self closeInterface];
        return nil;
    }
    return self;
}

- (void)dealloc {
    [self closeInterface];
}

- (BOOL)connectInterfaceToService:(io_service_t)service
                            error:(NSError **)error {
    IOCFPlugInInterface **plugIn = NULL;
    IOUSBDeviceInterface **deviceInterface = NULL;
    SInt32 score = 0;
    kern_return_t result = IOCreatePlugInInterfaceForService(
        service,
        kIOUSBDeviceUserClientTypeID,
        kIOCFPlugInInterfaceID,
        &plugIn,
        &score
    );
    if (result != kIOReturnSuccess || !plugIn) {
        if (error) {
            *error = [NSError errorWithDomain:@"MidsceneUVC"
                                         code: result
                                     userInfo:@{
                NSLocalizedDescriptionKey: @"Could not open the USB device."
            }];
        }
        return NO;
    }

    HRESULT query = (*plugIn)->QueryInterface(
        plugIn,
        CFUUIDGetUUIDBytes(kIOUSBDeviceInterfaceID),
        (LPVOID *)&deviceInterface
    );
    IODestroyPlugInInterface(plugIn);
    if (query != 0 || !deviceInterface) return NO;

    IOUSBFindInterfaceRequest request = {
        .bInterfaceClass = kUSBVideoInterfaceClass,
        .bInterfaceSubClass = kUSBVideoControlSubClass,
        .bInterfaceProtocol = kIOUSBFindInterfaceDontCare,
        .bAlternateSetting = kIOUSBFindInterfaceDontCare,
    };
    io_iterator_t iterator = 0;
    result = (*deviceInterface)->CreateInterfaceIterator(
        deviceInterface,
        &request,
        &iterator
    );
    (*deviceInterface)->Release(deviceInterface);
    if (result != kIOReturnSuccess || !iterator) return NO;

    io_service_t interfaceService = 0;
    BOOL connected = NO;
    while ((interfaceService = IOIteratorNext(iterator))) {
        plugIn = NULL;
        result = IOCreatePlugInInterfaceForService(
            interfaceService,
            kIOUSBInterfaceUserClientTypeID,
            kIOCFPlugInInterfaceID,
            &plugIn,
            &score
        );
        IOObjectRelease(interfaceService);
        if (result != kIOReturnSuccess || !plugIn) continue;

        query = (*plugIn)->QueryInterface(
            plugIn,
            CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID),
            (LPVOID *)&_interface
        );
        IODestroyPlugInInterface(plugIn);
        if (query != 0 || !_interface) continue;

        if ((*_interface)->GetInterfaceNumber(
                _interface,
                &_videoInterfaceIndex
            ) != kIOReturnSuccess) {
            (*_interface)->Release(_interface);
            _interface = NULL;
            continue;
        }

        IOReturn openResult = (*_interface)->USBInterfaceOpen(_interface);
        if (openResult == kIOReturnSuccess) {
            _interfaceOpen = YES;
            _ownsInterface = YES;
        } else if (openResult == kIOReturnExclusiveAccess) {
            // A streaming client commonly keeps the interface open. Control
            // transfers still target the UVC control interface without
            // claiming its streaming endpoints.
            _interfaceOpen = YES;
            _ownsInterface = NO;
        } else {
            (*_interface)->Release(_interface);
            _interface = NULL;
            continue;
        }

        [self readUnitIds];
        connected = YES;
        break;
    }
    IOObjectRelease(iterator);
    if (!connected && error) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code: kIOReturnNotFound
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"This camera does not expose a standard UVC control interface."
        }];
    }
    return connected;
}

- (void)readUnitIds {
    IOUSBDescriptorHeader *descriptor =
        (*_interface)->FindNextAssociatedDescriptor(
            _interface,
            NULL,
            UVC_CS_INTERFACE
        );
    if (!descriptor || descriptor->bDescriptorSubType != UVC_VC_HEADER) return;

    const uint8_t *base = (const uint8_t *)descriptor;
    if (descriptor->bLength < 12) return;
    uint16_t totalLength = OSReadLittleInt16(base, 6);
    if (totalLength <= descriptor->bLength) return;

    const uint8_t *cursor = base + descriptor->bLength;
    const uint8_t *end = base + totalLength;
    while (cursor < end && cursor[0] >= 3) {
        uint8_t length = cursor[0];
        uint8_t type = cursor[1];
        uint8_t subtype = cursor[2];
        if (length == 0 || cursor + length > end) break;

        if (type == UVC_CS_INTERFACE && length >= 4) {
            if (subtype == UVC_VC_INPUT_TERMINAL &&
                length >= 8 &&
                OSReadLittleInt16(cursor, 4) == 0x0201) {
                _inputTerminalId = cursor[3];
            } else if (subtype == UVC_VC_PROCESSING_UNIT) {
                _processingUnitId = cursor[3];
            }
        }
        cursor += length;
    }
}

- (void)closeInterface {
    if (_interface) {
        if (_ownsInterface && _interfaceOpen) {
            (*_interface)->USBInterfaceClose(_interface);
        }
        (*_interface)->Release(_interface);
        _interface = NULL;
    }
    _interfaceOpen = NO;
    _ownsInterface = NO;
}

- (BOOL)controlRequest:(IOUSBDevRequest *)request error:(NSError **)error {
    if (!_interface || !_interfaceOpen) return NO;
    IOReturn result = (*_interface)->ControlRequest(_interface, 0, request);
    if (result == kIOReturnSuccess) return YES;
    if (error) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code: result
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                [NSString stringWithFormat:
                    @"UVC control request failed (IOKit 0x%08x).",
                    result]
        }];
    }
    return NO;
}

- (BOOL)getData:(void *)data
         length:(uint16_t)length
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error {
    IOUSBDevRequest request = {
        .bmRequestType = USBmakebmRequestType(
            kUSBIn,
            kUSBClass,
            kUSBInterface
        ),
        .bRequest = UVC_GET_CUR,
        .wValue = (uint16_t)(selector << 8),
        .wIndex =
            (uint16_t)((unitId << 8) | self.videoInterfaceIndex),
        .wLength = length,
        .wLenDone = 0,
        .pData = data,
    };
    return [self controlRequest:&request error:error];
}

- (BOOL)getData:(void *)data
         length:(uint16_t)length
        request:(uint8_t)requestCode
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error {
    IOUSBDevRequest request = {
        .bmRequestType = USBmakebmRequestType(
            kUSBIn,
            kUSBClass,
            kUSBInterface
        ),
        .bRequest = requestCode,
        .wValue = (uint16_t)(selector << 8),
        .wIndex =
            (uint16_t)((unitId << 8) | self.videoInterfaceIndex),
        .wLength = length,
        .wLenDone = 0,
        .pData = data,
    };
    NSError *ignored = nil;
    return [self controlRequest:&request error:&ignored];
}

- (BOOL)setData:(const void *)data
         length:(uint16_t)length
       selector:(uint8_t)selector
         unitId:(uint8_t)unitId
          error:(NSError **)error {
    IOUSBDevRequest request = {
        .bmRequestType = USBmakebmRequestType(
            kUSBOut,
            kUSBClass,
            kUSBInterface
        ),
        .bRequest = UVC_SET_CUR,
        .wValue = (uint16_t)(selector << 8),
        .wIndex =
            (uint16_t)((unitId << 8) | self.videoInterfaceIndex),
        .wLength = length,
        .wLenDone = 0,
        .pData = (void *)data,
    };
    return [self controlRequest:&request error:error];
}

- (BOOL)loadMeta:(UVCMeta *)meta
        selector:(uint8_t)selector
          unitId:(uint8_t)unitId
            size:(size_t)size {
    memset(meta, 0, sizeof(*meta));
    meta->size = size;
    uint8_t info = 0;
    if (![self getData:&info
                length:1
               request:UVC_GET_INFO
              selector:selector
                unitId:unitId
                 error:NULL]) {
        return NO;
    }

    meta->available = YES;
    meta->supportsGet = (info & 0x01) != 0;
    meta->supportsSet = (info & 0x02) != 0;

    uint8_t bytes[4] = {0};
    if (meta->supportsGet &&
        [self getData:bytes
                length:(uint16_t)size
               request:UVC_GET_CUR
              selector:selector
                unitId:unitId
                 error:NULL]) {
        meta->current = ReadUnsigned(bytes, size);
    } else if (meta->supportsGet) {
        meta->supportsGet = NO;
    }

    memset(bytes, 0, sizeof(bytes));
    if ([self getData:bytes
                length:(uint16_t)size
               request:UVC_GET_MIN
              selector:selector
                unitId:unitId
                 error:NULL]) {
        meta->minimum = ReadUnsigned(bytes, size);
    }
    memset(bytes, 0, sizeof(bytes));
    if ([self getData:bytes
                length:(uint16_t)size
               request:UVC_GET_MAX
              selector:selector
                unitId:unitId
                 error:NULL]) {
        meta->maximum = ReadUnsigned(bytes, size);
    }
    memset(bytes, 0, sizeof(bytes));
    if ([self getData:bytes
                length:(uint16_t)size
               request:UVC_GET_RES
              selector:selector
                unitId:unitId
                 error:NULL]) {
        meta->resolution = ReadUnsigned(bytes, size);
    }
    memset(bytes, 0, sizeof(bytes));
    if ([self getData:bytes
                length:(uint16_t)size
               request:UVC_GET_DEF
              selector:selector
                unitId:unitId
                 error:NULL]) {
        meta->defaultValue = ReadUnsigned(bytes, size);
    } else {
        meta->defaultValue = meta->current;
    }
    if (meta->maximum < meta->minimum) {
        meta->maximum = meta->minimum;
    }
    return YES;
}

- (NSDictionary *)focusControl {
    UVCMeta focus;
    UVCMeta automatic;
    if (![self loadMeta:&focus
               selector:UVC_CT_FOCUS_ABSOLUTE
                 unitId:self.inputTerminalId
                   size:2] ||
        !focus.supportsGet ||
        focus.maximum <= focus.minimum) {
        return nil;
    }
    [self loadMeta:&automatic
          selector:UVC_CT_FOCUS_AUTO
            unitId:self.inputTerminalId
              size:1];

    BOOL supportsAuto = automatic.available && automatic.supportsSet;
    BOOL supportsManual =
        focus.supportsSet &&
        (!automatic.available || automatic.supportsSet);
    if (!supportsAuto && !supportsManual) return nil;

    double range = (double)(focus.maximum - focus.minimum);
    double value =
        ((double)focus.current - (double)focus.minimum) / range;
    double defaultValue =
        ((double)focus.defaultValue - (double)focus.minimum) / range;
    double step = focus.resolution > 0 ? focus.resolution / range : 0.01;
    return @{
        @"property": @"focus",
        @"value": @(value),
        @"mode":
            automatic.available && automatic.current != 0
                ? @"auto"
                : @"manual",
        @"min": @0,
        @"max": @1,
        @"step": @(step),
        @"default": @(defaultValue),
        @"supportsAuto": @(supportsAuto),
        @"supportsManual": @(supportsManual),
    };
}

- (NSDictionary *)exposureControl {
    UVCMeta exposure;
    UVCMeta automatic;
    if (![self loadMeta:&exposure
               selector:UVC_CT_EXPOSURE_TIME_ABSOLUTE
                 unitId:self.inputTerminalId
                   size:4] ||
        !exposure.supportsGet ||
        exposure.maximum <= exposure.minimum) {
        return nil;
    }
    [self loadMeta:&automatic
          selector:UVC_CT_AE_MODE
            unitId:self.inputTerminalId
              size:1];

    BOOL supportsAuto = automatic.available && automatic.supportsSet;
    BOOL supportsManual =
        exposure.supportsSet &&
        (!automatic.available || automatic.supportsSet);
    if (!supportsAuto && !supportsManual) return nil;

    double rawMin = MAX(1.0, (double)exposure.minimum);
    double rawMax = MAX(rawMin, (double)exposure.maximum);
    double currentSeconds = MAX(1.0, (double)exposure.current) / 10000.0;
    double defaultSeconds =
        MAX(1.0, (double)exposure.defaultValue) / 10000.0;
    return @{
        @"property": @"exposure",
        @"value": @(log2(currentSeconds)),
        @"mode":
            automatic.available && (automatic.current & 0x01) != 0
                ? @"manual"
                : @"auto",
        @"min": @(log2(rawMin / 10000.0)),
        @"max": @(log2(rawMax / 10000.0)),
        @"step": @1,
        @"default": @(log2(defaultSeconds)),
        @"supportsAuto": @(supportsAuto),
        @"supportsManual": @(supportsManual),
    };
}

- (NSDictionary *)gainControl {
    UVCMeta gain;
    if (![self loadMeta:&gain
               selector:UVC_PU_GAIN
                 unitId:self.processingUnitId
                   size:2] ||
        !gain.supportsGet ||
        !gain.supportsSet ||
        gain.maximum <= gain.minimum) {
        return nil;
    }
    double step = gain.resolution > 0 ? (double)gain.resolution : 1;
    return @{
        @"property": @"gain",
        @"value": @((double)gain.current),
        @"mode": @"manual",
        @"min": @((double)gain.minimum),
        @"max": @((double)gain.maximum),
        @"step": @(step),
        @"default": @((double)gain.defaultValue),
        @"supportsAuto": @NO,
        @"supportsManual": @YES,
    };
}

- (NSDictionary *)whiteBalanceControl {
    UVCMeta temperature;
    UVCMeta automatic;
    if (![self loadMeta:&temperature
               selector:UVC_PU_WHITE_BALANCE_TEMPERATURE
                 unitId:self.processingUnitId
                   size:2] ||
        !temperature.supportsGet ||
        temperature.maximum <= temperature.minimum) {
        return nil;
    }
    [self loadMeta:&automatic
          selector:UVC_PU_WHITE_BALANCE_TEMPERATURE_AUTO
            unitId:self.processingUnitId
              size:1];

    BOOL supportsAuto = automatic.available && automatic.supportsSet;
    BOOL supportsManual =
        temperature.supportsSet &&
        (!automatic.available || automatic.supportsSet);
    if (!supportsAuto && !supportsManual) return nil;

    double step = temperature.resolution > 0
        ? (double)temperature.resolution
        : 100;
    return @{
        @"property": @"whiteBalance",
        @"value": @((double)temperature.current),
        @"mode":
            automatic.available && automatic.current != 0
                ? @"auto"
                : @"manual",
        @"min": @((double)temperature.minimum),
        @"max": @((double)temperature.maximum),
        @"step": @(step),
        @"default": @((double)temperature.defaultValue),
        @"supportsAuto": @(supportsAuto),
        @"supportsManual": @(supportsManual),
    };
}

- (NSArray<NSDictionary *> *)queryControls:(NSError **)error {
    NSMutableArray *controls = [NSMutableArray array];
    NSDictionary *focus = [self focusControl];
    if (focus) [controls addObject:focus];
    NSDictionary *exposure = [self exposureControl];
    if (exposure) [controls addObject:exposure];
    NSDictionary *gain = [self gainControl];
    if (gain) [controls addObject:gain];
    NSDictionary *whiteBalance = [self whiteBalanceControl];
    if (whiteBalance) [controls addObject:whiteBalance];
    return controls;
}

- (uint64_t)quantize:(double)value meta:(const UVCMeta *)meta {
    double minimum = (double)meta->minimum;
    double maximum = (double)MAX(meta->minimum, meta->maximum);
    double step = MAX(1.0, (double)meta->resolution);
    double clamped = MIN(maximum, MAX(minimum, value));
    double quantized =
        minimum + round((clamped - minimum) / step) * step;
    return (uint64_t)MIN(maximum, MAX(minimum, quantized));
}

- (BOOL)writeAutoValue:(uint64_t)value
              selector:(uint8_t)selector
                unitId:(uint8_t)unitId
                 error:(NSError **)error {
    uint8_t bytes[1] = {(uint8_t)value};
    return [self setData:bytes
                 length:1
               selector:selector
                 unitId:unitId
                  error:error];
}

- (BOOL)setFocus:(double)value
            mode:(NSString *)mode
           error:(NSError **)error {
    UVCMeta focus;
    UVCMeta automatic;
    if (![self loadMeta:&focus
               selector:UVC_CT_FOCUS_ABSOLUTE
                 unitId:self.inputTerminalId
                   size:2] ||
        focus.maximum <= focus.minimum) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:1
                                 userInfo:@{
            NSLocalizedDescriptionKey: @"UVC focus controls are unavailable."
        }];
        return NO;
    }
    [self loadMeta:&automatic
          selector:UVC_CT_FOCUS_AUTO
            unitId:self.inputTerminalId
              size:1];

    if ([mode isEqualToString:@"auto"]) {
        if (!automatic.available || !automatic.supportsSet) {
            *error = [NSError errorWithDomain:@"MidsceneUVC"
                                         code:2
                                     userInfo:@{
                NSLocalizedDescriptionKey:
                    @"UVC automatic focus is unavailable."
            }];
            return NO;
        }
        return [self writeAutoValue:1
                           selector:UVC_CT_FOCUS_AUTO
                             unitId:self.inputTerminalId
                              error:error];
    }

    if (automatic.available &&
        !automatic.supportsSet) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:3
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC automatic focus cannot be disabled."
        }];
        return NO;
    }
    if (automatic.available &&
        ![self writeAutoValue:0
                     selector:UVC_CT_FOCUS_AUTO
                       unitId:self.inputTerminalId
                        error:error]) {
        return NO;
    }
    double raw = (double)focus.minimum +
        MIN(1, MAX(0, value)) *
        (double)(focus.maximum - focus.minimum);
    uint8_t bytes[2] = {0};
    WriteUnsigned(bytes, 2, [self quantize:raw meta:&focus]);
    return [self setData:bytes
                 length:2
               selector:UVC_CT_FOCUS_ABSOLUTE
                 unitId:self.inputTerminalId
                  error:error];
}

- (BOOL)setExposure:(double)value
               mode:(NSString *)mode
              error:(NSError **)error {
    UVCMeta exposure;
    UVCMeta automatic;
    if (![self loadMeta:&exposure
               selector:UVC_CT_EXPOSURE_TIME_ABSOLUTE
                 unitId:self.inputTerminalId
                   size:4] ||
        exposure.maximum <= exposure.minimum) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:4
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC exposure controls are unavailable."
        }];
        return NO;
    }
    [self loadMeta:&automatic
          selector:UVC_CT_AE_MODE
            unitId:self.inputTerminalId
              size:1];
    if (!automatic.available || !automatic.supportsSet) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:5
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC exposure mode cannot be changed."
        }];
        return NO;
    }

    if ([mode isEqualToString:@"auto"]) {
        return [self writeAutoValue:2
                           selector:UVC_CT_AE_MODE
                             unitId:self.inputTerminalId
                              error:error];
    }
    if (![self writeAutoValue:1
                     selector:UVC_CT_AE_MODE
                       unitId:self.inputTerminalId
                        error:error]) {
        return NO;
    }
    double raw = pow(2.0, value) * 10000.0;
    uint8_t bytes[4] = {0};
    WriteUnsigned(bytes, 4, [self quantize:raw meta:&exposure]);
    return [self setData:bytes
                 length:4
               selector:UVC_CT_EXPOSURE_TIME_ABSOLUTE
                 unitId:self.inputTerminalId
                  error:error];
}

- (BOOL)setGain:(double)value
           mode:(NSString *)mode
          error:(NSError **)error {
    if (![mode isEqualToString:@"manual"]) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:6
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC camera gain has no independent automatic mode."
        }];
        return NO;
    }
    UVCMeta gain;
    if (![self loadMeta:&gain
               selector:UVC_PU_GAIN
                 unitId:self.processingUnitId
                   size:2] ||
        !gain.supportsSet ||
        gain.maximum <= gain.minimum) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:7
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC camera gain is unavailable."
        }];
        return NO;
    }
    uint8_t bytes[2] = {0};
    WriteUnsigned(bytes, 2, [self quantize:value meta:&gain]);
    return [self setData:bytes
                 length:2
               selector:UVC_PU_GAIN
                 unitId:self.processingUnitId
                  error:error];
}

- (BOOL)setWhiteBalance:(double)value
                   mode:(NSString *)mode
                  error:(NSError **)error {
    UVCMeta temperature;
    UVCMeta automatic;
    if (![self loadMeta:&temperature
               selector:UVC_PU_WHITE_BALANCE_TEMPERATURE
                 unitId:self.processingUnitId
                   size:2] ||
        temperature.maximum <= temperature.minimum) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:8
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC white balance controls are unavailable."
        }];
        return NO;
    }
    [self loadMeta:&automatic
          selector:UVC_PU_WHITE_BALANCE_TEMPERATURE_AUTO
            unitId:self.processingUnitId
              size:1];
    if (!automatic.available || !automatic.supportsSet) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:9
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                @"UVC white balance mode cannot be changed."
        }];
        return NO;
    }
    if ([mode isEqualToString:@"auto"]) {
        return [self writeAutoValue:1
                           selector:UVC_PU_WHITE_BALANCE_TEMPERATURE_AUTO
                             unitId:self.processingUnitId
                              error:error];
    }
    if (![self writeAutoValue:0
                     selector:UVC_PU_WHITE_BALANCE_TEMPERATURE_AUTO
                       unitId:self.processingUnitId
                        error:error]) {
        return NO;
    }
    uint8_t bytes[2] = {0};
    WriteUnsigned(bytes, 2, [self quantize:value meta:&temperature]);
    return [self setData:bytes
                 length:2
               selector:UVC_PU_WHITE_BALANCE_TEMPERATURE
                 unitId:self.processingUnitId
                  error:error];
}

- (BOOL)setProperty:(NSString *)property
              value:(double)value
               mode:(NSString *)mode
              error:(NSError **)error {
    if ([property isEqualToString:@"focus"]) {
        return [self setFocus:value mode:mode error:error];
    }
    if ([property isEqualToString:@"exposure"]) {
        return [self setExposure:value mode:mode error:error];
    }
    if ([property isEqualToString:@"gain"]) {
        return [self setGain:value mode:mode error:error];
    }
    if ([property isEqualToString:@"whiteBalance"]) {
        return [self setWhiteBalance:value mode:mode error:error];
    }
    if (error) {
        *error = [NSError errorWithDomain:@"MidsceneUVC"
                                     code:10
                                 userInfo:@{
            NSLocalizedDescriptionKey:
                [NSString stringWithFormat:
                    @"Unsupported UVC property: %@",
                    property]
        }];
    }
    return NO;
}

@end

static NSArray<NSDictionary *> *UVCDeviceList(NSError **error) {
    CFMutableDictionaryRef matching = IOServiceMatching(kIOUSBDeviceClassName);
    if (!matching) return @[];
    io_iterator_t iterator = 0;
    if (IOServiceGetMatchingServices(
            kIOMainPortDefault,
            matching,
            &iterator
        ) != KERN_SUCCESS) {
        return @[];
    }

    NSMutableArray *devices = [NSMutableArray array];
    io_service_t service = 0;
    while ((service = IOIteratorNext(iterator))) {
        NSNumber *location =
            NumberProperty(service, CFSTR(kUSBDevicePropertyLocationID));
        if (location) {
            NSError *ignored = nil;
            MidsceneUVCDevice *device = [[MidsceneUVCDevice alloc]
                initWithService:service
                     locationId:location.unsignedIntValue
                          error:&ignored];
            if (device) {
                [devices addObject:@{
                    @"locationId": @(device.locationId),
                    @"vendorId": @(device.vendorId),
                    @"productId": @(device.productId),
                    @"name": device.name,
                    @"serialNumber": device.serialNumber ?: @"",
                }];
            }
        }
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator);
    return devices;
}

char *MidsceneUVCDeviceListJSON(void) {
    @autoreleasepool {
        return CopyJSON(@{
            @"ok": @YES,
            @"devices": UVCDeviceList(NULL),
        });
    }
}

MidsceneUVCDeviceRef MidsceneUVCDeviceCreateForLocation(uint32_t locationId) {
    @autoreleasepool {
        io_service_t service = USBServiceForLocation(locationId);
        if (!service) return NULL;
        MidsceneUVCDevice *device = [[MidsceneUVCDevice alloc]
            initWithService:service
                 locationId:locationId
                      error:NULL];
        IOObjectRelease(service);
        return (__bridge_retained void *)device;
    }
}

char *MidsceneUVCDeviceQueryJSON(MidsceneUVCDeviceRef reference) {
    @autoreleasepool {
        MidsceneUVCDevice *device =
            (__bridge MidsceneUVCDevice *)reference;
        NSError *error = nil;
        NSArray *controls = [device queryControls:&error];
        if (!controls) return CopyJSON(ErrorJSON(error.localizedDescription));
        NSMutableDictionary *indexed = [NSMutableDictionary dictionary];
        for (NSDictionary *control in controls) {
            indexed[control[@"property"]] = control;
        }
        return CopyJSON(@{
            @"ok": @YES,
            @"controls": indexed,
        });
    }
}

char *MidsceneUVCDeviceSetJSON(
    MidsceneUVCDeviceRef reference,
    const char *property,
    double value,
    const char *mode
) {
    @autoreleasepool {
        MidsceneUVCDevice *device =
            (__bridge MidsceneUVCDevice *)reference;
        NSError *error = nil;
        NSString *propertyString =
            [NSString stringWithUTF8String:property ?: ""];
        NSString *modeString = [NSString stringWithUTF8String:mode ?: ""];
        if (![device setProperty:propertyString
                           value:value
                            mode:modeString
                           error:&error]) {
            return CopyJSON(ErrorJSON(error.localizedDescription));
        }
        return CopyJSON(@{@"ok": @YES});
    }
}

void MidsceneUVCDeviceDestroy(MidsceneUVCDeviceRef reference) {
    if (!reference) return;
    MidsceneUVCDevice *device =
        (__bridge_transfer MidsceneUVCDevice *)reference;
    device = nil;
}

void MidsceneUVCFreeString(char *value) {
    free(value);
}
