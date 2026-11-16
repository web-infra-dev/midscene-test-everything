#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

static inline size_t HIDReportLength(unsigned report) {
    switch (report) {
        case 1: return 8;
        case 2: return 5;
        case 3: return 4;
        case 4: return 2;
        default: return 0;
    }
}

// HIDP DATA(Input), followed by report ID and the descriptor's exact payload.
static inline size_t HIDInputPacket(unsigned report, const uint8_t *bytes,
                                    size_t length, uint8_t packet[10]) {
    if (!HIDReportLength(report) || length != HIDReportLength(report)) return 0;
    packet[0] = 0xa1;
    packet[1] = (uint8_t)report;
    memcpy(packet + 2, bytes, length);
    return length + 2;
}

// This descriptor has no boot protocol. Never acknowledge boot mode then keep
// sending report-mode packets. GET_REPORT itself is handled with per-peer state.
static inline size_t HIDControlReply(const uint8_t *request, size_t length,
                                     uint8_t reply[10]) {
    if (!length) return 0;
    switch (request[0] & 0xf0) {
        case 0x60: reply[0] = 0xa0; reply[1] = 1; return 2; // GET_PROTOCOL
        case 0x70: reply[0] = (request[0] & 0x0f) == 1 ? 0 : 3; return 1;
        case 0x80: reply[0] = 0xa0; reply[1] = 0; return 2; // GET_IDLE
        case 0x90: reply[0] = 0; return 1; // SET_IDLE
        case 0x50: // SET_REPORT: keyboard LED output only
            reply[0] = length == 3 && request[0] == 0x52 && request[1] == 1 ? 0 : 2;
            return 1;
        case 0x10: return 0; // HID_CONTROL (including virtual cable unplug)
        case 0x00: return 0; // handshake
        default: reply[0] = 3; return 1; // unsupported request
    }
}
