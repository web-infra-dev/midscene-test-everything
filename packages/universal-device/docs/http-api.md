# Midscene Universal Device HTTP API Reference

> Conforms to OpenAPI `3.0.3` (API version `0.1.0`). Services built with `@midscene/universal-device/server` automatically expose Swagger UI at `/api/docs/` and the full OpenAPI schema at `/api/openapi.json`.

## Authentication & Conventions

- **Authentication**: All `/api/v1/` endpoints require `Authorization: Bearer <token>`.
- **Content type**: Requests and responses use `application/json` by default (`GET .../screenshot` also supports `Accept: image/jpeg`).
- **Coordinates**: All coordinates are in screenshot pixels with `(0, 0)` at the top-left corner.

## Standard Flow

```text
GET /api/v1/devices              List devices and supported actions
        │
        ▼
POST /api/v1/sessions            Acquire an exclusive session (returns session id)
        │
        ├──▶ GET  /api/v1/sessions/{id}/screenshot   Capture a screenshot
        ├──▶ POST /api/v1/sessions/{id}/actions      Execute an input action
        ├──▶ POST /api/v1/sessions/{id}/heartbeat    Renew the session lease
        └──▶ GET  /api/v1/sessions/{id}/preview      Stream MJPEG preview (optional)
        │
        ▼
DELETE /api/v1/sessions/{id}     Release the session
```

---

## Endpoints

### 1. List devices

`GET /api/v1/devices`

Returns configured device profiles and their supported action types.

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | Configured device profiles | `{ devices: Device[] }` |
| `401` | Missing or invalid access token | `ErrorResponse` |
| `503` | Device backend unavailable | `ErrorResponse` |

#### Example (`200`)

```json
{
  "devices": [
    {
      "id": "iphone-1",
      "name": "iPhone 15 Pro",
      "status": "available",
      "screenSource": "usb",
      "actions": ["tap", "doubleTap", "longPress", "swipe", "typeText", "home"],
      "preview": "mjpeg",
      "inputGuidance": "Optional device-specific instructions"
    }
  ]
}
```

---

### 2. Acquire a session

`POST /api/v1/sessions`

Acquires exclusive control of a ready device. Only one active session is allowed per device.

#### Request body

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `deviceId` | `string` | Yes | - | Target device ID (`1`–`128` chars) |
| `leaseMs` | `integer` | No | `30000` | Lease TTL in milliseconds (`5000`–`300000`) |

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `201` | Device control lease created | `Session` |
| `400` | Invalid request | `ErrorResponse` |
| `401` | Unauthorized | `ErrorResponse` |
| `409` | Device offline or in use | `ErrorResponse` |
| `503` | Device service stopping or updating | `ErrorResponse` |

#### Example (`201`)

```json
{
  "id": "sess_abc123",
  "deviceId": "iphone-1",
  "expiresInMs": 30000
}
```

---

### 3. Renew a session

`POST /api/v1/sessions/{id}/heartbeat`

Extends the lease of an active session.

#### Path parameters

- `id` (`string`, required): Session ID.

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | Renewed | - |
| `401` | Unauthorized | `ErrorResponse` |
| `410` | Control session ended | `ErrorResponse` |

---

### 4. Release a session

`DELETE /api/v1/sessions/{id}`

Releases exclusive control of the device.

#### Path parameters

- `id` (`string`, required): Session ID.

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | Released | - |
| `401` | Unauthorized | `ErrorResponse` |

---

### 5. Capture a screenshot

`GET /api/v1/sessions/{id}/screenshot`

Returns JSON with a base64-encoded JPEG by default, or raw JPEG bytes when `Accept: image/jpeg` is sent.

#### Path parameters

- `id` (`string`, required): Session ID.

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | Screenshot frame | `ScreenFrame` (JSON) or `image/jpeg` |
| `401` | Unauthorized | `ErrorResponse` |
| `410` | Control session ended | `ErrorResponse` |

#### Example (`200`, JSON)

```json
{
  "jpeg": "<base64-encoded-jpeg>",
  "width": 1179,
  "height": 2556,
  "sequence": 42,
  "receivedAt": 1731920000000
}
```

---

### 6. Stream live preview

`GET /api/v1/sessions/{id}/preview`

Streams `multipart/x-mixed-replace` MJPEG frames when the device advertises `preview: "mjpeg"`.

#### Path parameters

- `id` (`string`, required): Session ID.

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | MJPEG preview stream | `multipart/x-mixed-replace` |
| `401` | Unauthorized | `ErrorResponse` |
| `404` | Device has no live preview | `ErrorResponse` |
| `410` | Control session ended | `ErrorResponse` |

---

### 7. Execute an action

`POST /api/v1/sessions/{id}/actions`

Executes a single `InputAction`. The `type` must be listed in `Device.actions`.

#### Path parameters

- `id` (`string`, required): Session ID.

#### Request body

`InputAction` union (see [Schemas](#inputaction)).

#### Responses

| Status | Description | Schema |
| --- | --- | --- |
| `200` | Action completed | - |
| `400` | Invalid action payload | `ErrorResponse` |
| `401` | Unauthorized | `ErrorResponse` |
| `409` | Another action is in progress or execution failed | `ErrorResponse` |
| `410` | Control session ended | `ErrorResponse` |
| `422` | Device does not support this action | `ErrorResponse` |

---

## Schemas

### `Point`

```ts
type Point = {
  x: number; // X coordinate in screenshot pixels
  y: number; // Y coordinate in screenshot pixels
};
```

### `Device`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Unique device identifier |
| `name` | `string` | Yes | Display name |
| `status` | `'available' \| 'busy' \| 'offline'` | Yes | Current availability |
| `actions` | `string[]` | Yes | Supported action types |
| `screenSource` | `'usb' \| 'camera' \| 'airplay'` | No | Screen capture source |
| `preview` | `'mjpeg'` | No | Set to `'mjpeg'` when live preview is supported |
| `inputGuidance` | `string` | No | Optional device-specific instructions |

### `Session`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Session ID |
| `deviceId` | `string` | Yes | Bound device ID |
| `expiresInMs` | `integer` | Yes | Remaining lease time in milliseconds |

### `ScreenFrame`

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `jpeg` | `string` (base64) | Yes | Base64-encoded JPEG |
| `width` | `integer` | Yes | Image width in pixels |
| `height` | `integer` | Yes | Image height in pixels |
| `sequence` | `integer` | Yes | Frame sequence number |
| `receivedAt` | `integer` | Yes | Unix timestamp in milliseconds |

### `InputAction`

Discriminated union keyed by `type`:

| `type` | Required fields | Optional fields & constraints | Description |
| --- | --- | --- | --- |
| `tap` | `point: Point` | - | Single tap |
| `doubleTap` | `point: Point` | - | Double tap |
| `longPress` | `point: Point` | `durationMs?: number` (`0`–`5000`) | Long press |
| `swipe` | `from: Point`, `to: Point` | `durationMs?: number` (`0`–`5000`) | Swipe gesture |
| `dragAndDrop` | `from: Point`, `to: Point` | `durationMs?: number` (`0`–`5000`) | Drag and drop |
| `scroll` | `direction: 'up' \| 'down'` | `steps?: integer` (`1`–`24`), `point?: Point` | Scroll |
| `typeText` | `text: string` (max `8192` chars) | `replace?: boolean` | Type text |
| `clearInput` | - | - | Clear current input |
| `key` | `key: string` (`1`–`128` chars) | - | Key press |
| `home` | - | - | Go to home screen |
| `back` | - | - | Navigate back |

### `ErrorResponse`

```ts
type ErrorResponse = {
  error: string;
  code?:
    | 'UNAUTHORIZED'
    | 'NOT_FOUND'
    | 'INVALID_REQUEST'
    | 'PAYLOAD_TOO_LARGE'
    | 'DEVICE_BUSY'
    | 'DEVICE_OFFLINE'
    | 'ACTION_IN_PROGRESS'
    | 'ACTION_UNSUPPORTED'
    | 'ACTION_FAILED'
    | 'SESSION_EXPIRED'
    | 'PREVIEW_UNAVAILABLE'
    | 'SERVICE_STOPPING'
    | 'SERVICE_UPDATING'
    | 'SERVICE_UNAVAILABLE';
};
```
