#ifndef MIDSCENE_MACOS_CAMERA_UVC_H
#define MIDSCENE_MACOS_CAMERA_UVC_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void *MidsceneUVCDeviceRef;

char *MidsceneUVCDeviceListJSON(void);
MidsceneUVCDeviceRef MidsceneUVCDeviceCreateForLocation(uint32_t locationId);
char *MidsceneUVCDeviceQueryJSON(MidsceneUVCDeviceRef device);
char *MidsceneUVCDeviceSetJSON(
    MidsceneUVCDeviceRef device,
    const char *property,
    double value,
    const char *mode
);
void MidsceneUVCDeviceDestroy(MidsceneUVCDeviceRef device);
void MidsceneUVCFreeString(char *value);

#ifdef __cplusplus
}
#endif

#endif
