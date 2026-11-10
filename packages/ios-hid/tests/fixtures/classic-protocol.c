#include <assert.h>
#include "../../native/HIDProtocol.h"
#include "../../native/HIDDescriptor.h"
int main(void) {
    uint8_t packet[10], zero[8] = {0};
    const size_t sizes[] = {0,8,5,4,2};
    for (unsigned report = 1; report <= 4; report++) {
        assert(HIDInputPacket(report, zero, sizes[report], packet) == sizes[report]+2);
        assert(packet[0] == 0xa1 && packet[1] == report);
        assert(HIDInputPacket(report, zero, sizes[report]-1, packet) == 0);
    }
    assert(HIDInputPacket(0, zero, 8, packet) == 0);
    assert(HIDInputPacket(5, zero, 8, packet) == 0);
    uint8_t delta[] = {1,255,127,254};
    assert(HIDInputPacket(3, delta, sizeof(delta), packet) == 6);
    assert(memcmp(packet+2, delta, sizeof(delta)) == 0); // buttons, signed dX/dY/wheel preserved
    uint8_t protocol[] = {0x60}, reportMode[] = {0x71}, bootMode[] = {0x70};
    assert(HIDControlReply(protocol, 1, packet) == 2 && packet[0] == 0xa0 && packet[1] == 1);
    assert(HIDControlReply(reportMode, 1, packet) == 1 && packet[0] == 0);
    assert(HIDControlReply(bootMode, 1, packet) == 1 && packet[0] == 3);
    uint8_t led[] = {0x52,1,0x02}, invalid[] = {0x52,2,0};
    assert(HIDControlReply(led, sizeof(led), packet) == 1 && packet[0] == 0);
    assert(HIDControlReply(invalid, sizeof(invalid), packet) == 1 && packet[0] == 2);
    assert(HIDControlReply(led, 0, packet) == 0);
    // Every packet ID must be declared in the shipped descriptor, exactly once.
    for (unsigned id=1; id<=4; id++) {
        unsigned found=0;
        for (size_t i=0; i+1<sizeof(HIDDescriptor); i++)
            if (HIDDescriptor[i] == 0x85 && HIDDescriptor[i+1] == id) found++;
        assert(found == 1);
    }
    return 0;
}
