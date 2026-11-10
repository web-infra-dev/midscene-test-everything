#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <IOBluetooth/IOBluetooth.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <sys/socket.h>
#import <fcntl.h>
#import <unistd.h>
#import "HIDDescriptor.h"
#import "HIDProtocol.h"

// macOS does not expose a public classic HID peripheral API. Use the system's
// already-authorized IOBluetooth coordinator; do not alter TCC or impersonate a
// system daemon. These private entry points are checked before publishing SDP.
@interface NSObject (ClassicHID)
+ (id)sharedInstance;
- (id)peer;
- (void)setBTConnectable:(BOOL)value;
- (void)setBTDiscoverable:(BOOL)value;
@end

static void Emit(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (data) { fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout); }
}
static void Reply(id requestID, id result, NSString *error) {
    Emit(error ? @{@"id":requestID ?: @"", @"error":error}
               : @{@"id":requestID ?: @"", @"result":result ?: @YES});
}
static NSDictionary *UIntElement(uint32_t value, int length) {
    uint8_t bytes[4];
    for (int i = 0; i < length; i++) bytes[i] = (value >> (8 * (length-i-1))) & 255;
    return @{@"DataElementType":@1, @"DataElementSize":@0,
             @"DataElementValue":[NSData dataWithBytes:bytes length:length]};
}
static NSData *UUID16(uint16_t value) {
    uint8_t bytes[] = {value >> 8, value & 255};
    return [NSData dataWithBytes:bytes length:2];
}

@interface PendingWrite : NSObject
@property NSData *data;
@property NSUInteger offset;
@property CFAbsoluteTime deadline;
@property(copy) void (^completion)(NSString *);
@end
@implementation PendingWrite
@end

@interface HIDChannel : NSObject
@property id native;
@property NSString *peerID;
@property NSNumber *cid;
@property int psm;
@property int fd;
@property dispatch_source_t reader;
@property dispatch_source_t writer;
@property NSMutableArray<PendingWrite *> *writes;
@property BOOL closed;
@end
@implementation HIDChannel
@end

@interface ClassicHID : NSObject <CBCentralManagerDelegate>
@property CBCentralManager *central;
@property id manager;
@property dispatch_queue_t managerQueue;
@property IOBluetoothSDPServiceRecord *service;
@property NSMutableDictionary<NSString *, HIDChannel *> *channels;
@property NSMutableDictionary<NSString *, NSDictionary *> *identities;
@property NSMutableDictionary<NSString *, NSMutableDictionary *> *reports;
@property NSString *state;
@property NSString *localName;
@property BOOL stopping;
@property BOOL configured;
@property BOOL oldDiscoverable;
@property BOOL oldConnectable;
@property BluetoothClassOfDevice oldClass;
@property dispatch_source_t classTimer;
- (void)opened:(id)peer info:(NSDictionary *)info;
- (void)closed:(id)peer info:(NSDictionary *)info;
- (void)publish;
- (void)shutdown;
@end
static ClassicHID *server;
static IMP originalHandle;
static void PeerMessage(id peer, SEL selector, int message, id args) {
    int psm = [args[@"kCBMsgArgPSM"] intValue];
    if (message == 27 && (psm == 17 || psm == 19) &&
        [args[@"kCBMsgArgResult"] intValue] == 0) {
        // Retain the native channel before returning. Calling the original path
        // would create an unowned duplicate whose deallocation closes this FD.
        [server opened:peer info:args];
        return;
    }
    if (message == 28) {
        NSDictionary *info = [args copy];
        dispatch_async(dispatch_get_main_queue(), ^{ [server closed:peer info:info]; });
    }
    ((void (*)(id, SEL, int, id))originalHandle)(peer, selector, message, args);
}

@implementation ClassicHID
- (instancetype)init {
    if ((self = [super init])) {
        _channels = [NSMutableDictionary new];
        _identities = [NSMutableDictionary new];
        _reports = [NSMutableDictionary new];
        _state = @"starting";
        _localName = NSHost.currentHost.localizedName ?: @"Mac";
    }
    return self;
}
- (NSString *)key:(NSString *)peerID psm:(int)psm {
    return [NSString stringWithFormat:@"%@/%d", peerID, psm];
}
- (NSDictionary *)identity:(id)peer {
    id identifier = [peer valueForKey:@"identifier"];
    NSString *peerID = [identifier isKindOfClass:NSUUID.class] ? [identifier UUIDString] : nil;
    if (!peerID.length) return nil;
    NSString *name = [peer valueForKey:@"name"];
    NSString *address = [peer valueForKey:@"addressString"];
    return @{@"id":peerID, @"name":name.length ? name : [@"蓝牙设备 · " stringByAppendingString:[peerID substringToIndex:8]],
             @"address":address ?: @"", @"reports":@[@1,@2,@3,@4]};
}
- (NSDictionary *)status {
    NSMutableArray *hosts = [NSMutableArray new];
    for (NSString *peerID in [self.identities.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
        if (self.channels[[self key:peerID psm:17]] && self.channels[[self key:peerID psm:19]])
            [hosts addObject:self.identities[peerID]];
    }
    return @{@"state":self.state, @"serviceName":self.localName,
             @"transport":@"classic", @"hosts":hosts};
}
- (void)publish { Emit(@{@"event":@"bluetooth-status", @"result":[self status]}); }
- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    if (central.state != CBManagerStatePoweredOn) {
        for (HIDChannel *channel in self.channels.allValues.copy) [self drop:channel reason:@"Bluetooth unavailable"];
        self.state = central.state == CBManagerStatePoweredOff ? @"bluetooth off" :
                     central.state == CBManagerStateUnauthorized ? @"Bluetooth not allowed" : @"Bluetooth unavailable";
        [self publish];
        return;
    }
    if (!self.service && !self.stopping) [self startService];
    else { self.state = @"listening"; [self publish]; }
}
- (void)startService {
    @try {
        Class coordinatorClass = NSClassFromString(@"IOBluetoothCoreBluetoothCoordinator");
        Class peerClass = NSClassFromString(@"CBClassicPeer");
        Class channelClass = NSClassFromString(@"CBL2CAPChannel");
        Method handle = class_getInstanceMethod(peerClass, NSSelectorFromString(@"handleMsg:args:"));
        if (!coordinatorClass || !handle ||
            ![channelClass instancesRespondToSelector:NSSelectorFromString(@"initWithPeer:manager:info:")] ||
            ![channelClass instancesRespondToSelector:NSSelectorFromString(@"socketFD")])
            @throw [NSException exceptionWithName:@"Unsupported" reason:@"Classic Bluetooth HID unavailable on this macOS version" userInfo:nil];
        (void)[IOBluetoothDevice pairedDevices];
        id coordinator = [coordinatorClass sharedInstance];
        self.manager = [coordinator valueForKey:@"classicManager"];
        self.managerQueue = [coordinator valueForKey:@"coordinatorQueue"];
        if (!self.manager || !self.managerQueue ||
            ![self.manager respondsToSelector:@selector(setBTConnectable:)] ||
            ![self.manager respondsToSelector:@selector(setBTDiscoverable:)])
            @throw [NSException exceptionWithName:@"Unsupported" reason:@"Classic Bluetooth coordinator unavailable" userInfo:nil];
        if (!originalHandle) originalHandle = method_setImplementation(handle, (IMP)PeerMessage);
        dispatch_sync(self.managerQueue, ^{
            NSString *name = [self.manager valueForKey:@"localName"];
            if (name.length) self.localName = name;
            self.oldDiscoverable = [[self.manager valueForKey:@"discoverable"] boolValue];
            self.oldConnectable = [[self.manager valueForKey:@"connectable"] boolValue];
            self.configured = YES;
            [self.manager setBTConnectable:YES];
            [self.manager setBTDiscoverable:YES];
        });
        NSData *descriptor = [NSData dataWithBytes:HIDDescriptor length:sizeof(HIDDescriptor)];
        self.service = [IOBluetoothSDPServiceRecord publishedServiceRecordWithDictionary:@{
            @"0001 - ServiceClassIDList":@[UUID16(0x1124)],
            @"0004 - ProtocolDescriptorList":@[@[UUID16(0x0100),UIntElement(17,2)],@[UUID16(0x11)]],
            @"0005 - BrowseGroupList":@[UUID16(0x1002)],
            @"0006 - LanguageBaseAttributeIDList":@[UIntElement(0x656e,2),UIntElement(106,2),UIntElement(256,2)],
            @"0009 - BluetoothProfileDescriptorList":@[@[UUID16(0x1124),UIntElement(0x101,2)]],
            @"000D - AdditionalProtocolDescriptorLists":@[@[@[UUID16(0x0100),UIntElement(19,2)],@[UUID16(0x11)]]],
            @"0100 - ServiceName":@"Midscene iOS HID",
            @"0201 - HIDParserVersion":UIntElement(0x111,2),
            @"0202 - HIDDeviceSubclass":UIntElement(0xc0,1),
            @"0203 - HIDCountryCode":UIntElement(0,1),
            @"0204 - HIDVirtualCable":@YES, @"0205 - HIDReconnectInitiate":@YES,
            @"0206 - HIDDescriptorList":@[@[UIntElement(0x22,1),@{@"DataElementType":@4,@"DataElementValue":descriptor}]],
            @"0207 - HIDLANGIDBaseList":@[@[UIntElement(0x409,2),UIntElement(256,2)]],
            @"0209 - HIDBatteryPower":@NO, @"020A - HIDRemoteWake":@NO,
            @"020B - HIDProfileVersion":UIntElement(0x100,2),
            @"020C - HIDSupervisionTimeout":UIntElement(8000,2),
            @"020D - HIDNormallyConnectable":@YES, @"020E - HIDBootDevice":@NO,
            @"LocalAttributes":@{@"Persistent":@NO}
        }];
        BluetoothL2CAPPSM psm = 0;
        if (!self.service || [self.service getL2CAPPSM:&psm] != kIOReturnSuccess || psm != 17)
            @throw [NSException exceptionWithName:@"Service" reason:@"Classic HID service failed to publish on PSM 17" userInfo:nil];
        IOBluetoothHostController *host = IOBluetoothHostController.defaultController;
        self.oldClass = host.classOfDevice;
        [host setClassOfDevice:0x2540 forTimeInterval:120];
        self.classTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_timer(self.classTimer, dispatch_time(DISPATCH_TIME_NOW, 60*NSEC_PER_SEC), 60*NSEC_PER_SEC, NSEC_PER_SEC);
        dispatch_source_set_event_handler(self.classTimer, ^{ [host setClassOfDevice:0x2540 forTimeInterval:120]; });
        dispatch_resume(self.classTimer);
        self.state = @"listening";
    } @catch (NSException *exception) {
        self.state = [@"Classic Bluetooth failed: " stringByAppendingString:exception.reason ?: @"unknown error"];
    }
    [self publish];
}
- (void)opened:(id)peer info:(NSDictionary *)info {
    // Called on the coordinator queue, where the private peer/channel belong.
    @try {
        NSDictionary *identity = [self identity:peer];
        id channel = ((id (*)(id,SEL,id,id,id))objc_msgSend)(
            [NSClassFromString(@"CBL2CAPChannel") alloc],
            NSSelectorFromString(@"initWithPeer:manager:info:"), peer, self.manager, info);
        if (!channel || !identity) return;
        int fd = [[channel valueForKey:@"socketFD"] intValue];
        if (fd < 0) return;
        HIDChannel *entry = [HIDChannel new];
        entry.native = channel; entry.fd = fd; entry.psm = [info[@"kCBMsgArgPSM"] intValue];
        entry.cid = info[@"kCBMsgArgCID"]; entry.peerID = identity[@"id"];
        entry.writes = [NSMutableArray new];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (self.stopping) return;
            NSString *key = [self key:entry.peerID psm:entry.psm];
            HIDChannel *old = self.channels[key];
            if (old) [self drop:old reason:@"Bluetooth channel replaced"];
            int option = 1;
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &option, sizeof(option));
            fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
            self.identities[entry.peerID] = identity;
            self.channels[key] = entry;
            entry.reader = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, fd, 0, dispatch_get_main_queue());
            __weak HIDChannel *weakEntry = entry;
            dispatch_source_set_event_handler(entry.reader, ^{
                HIDChannel *current = weakEntry;
                if (current) [self read:current];
            });
            dispatch_resume(entry.reader);
            [self publish];
        });
    } @catch (NSException *exception) {
        dispatch_async(dispatch_get_main_queue(), ^{
            self.state = [@"Classic Bluetooth failed: " stringByAppendingString:exception.reason ?: @"channel unavailable"];
            [self publish];
        });
    }
}
- (void)closed:(id)peer info:(NSDictionary *)info {
    // A close can omit the PSM; CID prevents a late close from removing a replacement.
    id identifier = info[@"kCBMsgArgDeviceUUID"];
    NSString *peerID = [identifier isKindOfClass:NSUUID.class] ? [identifier UUIDString] : nil;
    for (HIDChannel *channel in self.channels.allValues.copy) {
        if ((!peerID || [channel.peerID isEqual:peerID]) && info[@"kCBMsgArgCID"] &&
            [channel.cid isEqual:info[@"kCBMsgArgCID"]])
            [self drop:channel reason:@"Bluetooth disconnected"];
    }
}
- (void)drop:(HIDChannel *)channel reason:(NSString *)reason {
    if (channel.closed) return;
    channel.closed = YES;
    if (channel.reader) dispatch_source_cancel(channel.reader);
    if (channel.writer) dispatch_source_cancel(channel.writer);
    for (PendingWrite *write in channel.writes.copy) write.completion(reason);
    [channel.writes removeAllObjects];
    NSString *key = [self key:channel.peerID psm:channel.psm];
    if (self.channels[key] == channel) [self.channels removeObjectForKey:key];
    // The native channel owns the FD. Do not close it again from a cancel handler.
    channel.native = nil;
    if (!self.channels[[self key:channel.peerID psm:17]] && !self.channels[[self key:channel.peerID psm:19]]) {
        [self.reports removeObjectForKey:channel.peerID];
        [self.identities removeObjectForKey:channel.peerID];
    }
    [self publish];
}
- (void)read:(HIDChannel *)channel {
    if (channel.closed) return;
    uint8_t bytes[2048];
    ssize_t count = recv(channel.fd, bytes, sizeof(bytes), 0);
    if (count <= 0) {
        if (count == 0 || (errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR))
            [self drop:channel reason:@"Bluetooth disconnected"];
        return;
    }
    if (channel.psm != 17) return;
    if (bytes[0] == 0x15) { // virtual cable unplug, not a transient idle event
        for (HIDChannel *other in self.channels.allValues.copy)
            if ([other.peerID isEqual:channel.peerID]) [self drop:other reason:@"Bluetooth unpaired"];
        return;
    }
    uint8_t response[10];
    size_t length;
    if ((bytes[0] & 0xf0) == 0x40) {
        unsigned report = count > 1 ? bytes[1] : 0;
        if ((bytes[0] & 3) == 1 && HIDReportLength(report)) {
            NSData *last = self.reports[channel.peerID][@(report)] ?: [NSMutableData dataWithLength:HIDReportLength(report)];
            length = HIDInputPacket(report, last.bytes, last.length, response);
        } else if ((bytes[0] & 3) == 2 && report == 1) {
            response[0] = 0xa2; response[1] = 1; response[2] = 0; length = 3;
        } else { response[0] = 2; length = 1; }
    } else length = HIDControlReply(bytes, (size_t)count, response);
    if (length) [self enqueue:[NSData dataWithBytes:response length:length] channel:channel completion:^(NSString *error) {
        if (error) [self drop:channel reason:error];
    }];
}
- (void)enqueue:(NSData *)data channel:(HIDChannel *)channel completion:(void (^)(NSString *))completion {
    if (channel.closed) { completion(@"Bluetooth disconnected"); return; }
    PendingWrite *write = [PendingWrite new];
    write.data = data; write.deadline = CFAbsoluteTimeGetCurrent() + 5; write.completion = completion;
    [channel.writes addObject:write];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if ([channel.writes containsObject:write]) [self drop:channel reason:@"Bluetooth send timed out"];
    });
    [self flush:channel];
}
- (void)flush:(HIDChannel *)channel {
    if (channel.psm == 19 && !self.channels[[self key:channel.peerID psm:17]]) {
        [self drop:channel reason:@"Bluetooth control channel disconnected"]; return;
    }
    while (!channel.closed && channel.writes.count) {
        PendingWrite *write = channel.writes.firstObject;
        if (CFAbsoluteTimeGetCurrent() > write.deadline) { [self drop:channel reason:@"Bluetooth send timed out"]; return; }
        ssize_t count = send(channel.fd, (const uint8_t *)write.data.bytes + write.offset, write.data.length-write.offset, 0);
        if (count < 0 && errno == EINTR) continue;
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            if (!channel.writer) {
                channel.writer = dispatch_source_create(DISPATCH_SOURCE_TYPE_WRITE, channel.fd, 0, dispatch_get_main_queue());
                __weak HIDChannel *weakChannel = channel;
                dispatch_source_set_event_handler(channel.writer, ^{ HIDChannel *current = weakChannel; if (current) [self flush:current]; });
                dispatch_resume(channel.writer);
            }
            return;
        }
        if (count <= 0) { [self drop:channel reason:@"Bluetooth send failed"]; return; }
        write.offset += (NSUInteger)count;
        if (write.offset == write.data.length) {
            [channel.writes removeObjectAtIndex:0];
            write.completion(nil);
        }
    }
    if (channel.writer) { dispatch_source_cancel(channel.writer); channel.writer = nil; }
}
- (void)request:(NSDictionary *)request {
    id requestID = request[@"id"];
    if ([request[@"method"] isEqual:@"status"]) { Reply(requestID, [self status], nil); return; }
    if (![request[@"method"] isEqual:@"send"]) { Reply(requestID, nil, @"Unknown Bluetooth command"); return; }
    NSString *peerID = request[@"peer"];
    HIDChannel *channel = [peerID isKindOfClass:NSString.class] ? self.channels[[self key:peerID psm:19]] : nil;
    if (!channel || !self.channels[[self key:peerID psm:17]]) {
        Reply(requestID, nil, @"Selected phone's classic Bluetooth HID is not connected"); return;
    }
    NSNumber *report = request[@"report"];
    NSArray *bytes = request[@"bytes"];
    unsigned reportID = [report isKindOfClass:NSNumber.class] ? report.unsignedIntValue : 0;
    if (![bytes isKindOfClass:NSArray.class] || !HIDReportLength(reportID) || bytes.count != HIDReportLength(reportID)) {
        Reply(requestID, nil, @"Invalid HID report length or ID"); return;
    }
    uint8_t payload[8], packet[10];
    for (NSUInteger i = 0; i < bytes.count; i++) {
        id value = bytes[i];
        if (![value isKindOfClass:NSNumber.class] || [value doubleValue] != [value integerValue] || [value integerValue] < 0 || [value integerValue] > 255) {
            Reply(requestID, nil, @"HID report bytes must be integers from 0 to 255"); return;
        }
        payload[i] = [value unsignedCharValue];
    }
    size_t length = HIDInputPacket(reportID, payload, bytes.count, packet);
    NSData *last = [NSData dataWithBytes:payload length:bytes.count];
    [self enqueue:[NSData dataWithBytes:packet length:length] channel:channel completion:^(NSString *error) {
        if (!error) {
            if (!self.reports[peerID]) self.reports[peerID] = [NSMutableDictionary new];
            self.reports[peerID][report] = last;
        }
        Reply(requestID, @YES, error);
    }];
}
- (void)shutdown {
    if (self.stopping) return;
    self.stopping = YES;
    if (self.classTimer) dispatch_source_cancel(self.classTimer);
    for (HIDChannel *channel in self.channels.allValues.copy) [self drop:channel reason:@"Bluetooth helper closing"];
    if (self.service) [self.service removeServiceRecord];
    if (self.configured) {
        dispatch_sync(self.managerQueue, ^{
            [self.manager setBTDiscoverable:self.oldDiscoverable];
            [self.manager setBTConnectable:self.oldConnectable];
        });
        [IOBluetoothHostController.defaultController setClassOfDevice:self.oldClass forTimeInterval:30];
    }
    exit(0);
}
@end

int main(void) {
    @autoreleasepool {
        server = [ClassicHID new];
        server.central = [[CBCentralManager alloc] initWithDelegate:server queue:dispatch_get_main_queue() options:nil];
        [server publish];
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN);
        NSMutableArray *signals = [NSMutableArray new];
        for (NSNumber *number in @[@(SIGTERM),@(SIGINT)]) {
            dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, number.intValue, 0, dispatch_get_main_queue());
            dispatch_source_set_event_handler(source, ^{ [server shutdown]; });
            dispatch_resume(source); [signals addObject:source];
        }
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
            char *line = NULL; size_t capacity = 0;
            while (getline(&line, &capacity, stdin) > 0) {
                @autoreleasepool {
                    NSData *data = [[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
                    NSDictionary *request = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
                    dispatch_async(dispatch_get_main_queue(), ^{
                        @try {
                            if ([request isKindOfClass:NSDictionary.class]) [server request:request];
                            else Reply(@"", nil, @"Invalid Bluetooth command JSON");
                        } @catch (NSException *exception) { Reply(request[@"id"], nil, exception.reason); }
                    });
                }
            }
            free(line);
            dispatch_async(dispatch_get_main_queue(), ^{ [server shutdown]; });
        });
        [[NSRunLoop currentRunLoop] run];
        (void)signals;
    }
}
