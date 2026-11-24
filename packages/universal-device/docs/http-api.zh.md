# Midscene Universal Device HTTP API 参考

> 本文档对应 OpenAPI 规范版本 `3.0.3`（API 版本 `0.1.0`）。基于 `@midscene/universal-device/server` 搭建的服务默认会在 `/api/docs/` 提供 Swagger UI，并在 `/api/openapi.json` 提供完整 OpenAPI 定义。

## 鉴权与基础约定

- **鉴权方式**：所有 `/api/v1/` 接口均需携带请求头 `Authorization: Bearer <token>`。
- **数据格式**：请求与响应默认使用 `application/json`（截图接口支持 `Accept: image/jpeg` 返回二进制流）。
- **坐标约定**：所有屏幕坐标均以截图像素为单位，原点 `(0, 0)` 位于截图左上角。

## 标准调用流程

```text
GET /api/v1/devices              列出设备与支持的操作
        │
        ▼
POST /api/v1/sessions            申请独占控制会话（返回 session id）
        │
        ├──▶ GET  /api/v1/sessions/{id}/screenshot   获取当前截图
        ├──▶ POST /api/v1/sessions/{id}/actions      执行输入操作
        ├──▶ POST /api/v1/sessions/{id}/heartbeat    续期会话租约
        └──▶ GET  /api/v1/sessions/{id}/preview      读取 MJPEG 预览流（可选）
        │
        ▼
DELETE /api/v1/sessions/{id}     释放控制会话
```

---

## 接口列表

### 1. 列出设备

`GET /api/v1/devices`

获取当前服务配置的设备列表及其支持的操作类型。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | 成功返回设备列表 | `{ devices: Device[] }` |
| `401` | 缺少或无效的 Bearer Token | `ErrorResponse` |
| `503` | 设备后端不可用 | `ErrorResponse` |

#### 响应示例（`200`）

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
      "inputGuidance": "可选的设备操作提示"
    }
  ]
}
```

---

### 2. 创建独占会话

`POST /api/v1/sessions`

为指定设备申请独占控制权。同一台设备同一时间仅允许一个活跃会话。

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `deviceId` | `string` | 是 | - | 目标设备 ID（长度 `1`～`128`） |
| `leaseMs` | `integer` | 否 | `30000` | 会话租约时长，单位毫秒（范围 `5000`～`300000`） |

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `201` | 会话创建成功 | `Session` |
| `400` | 请求参数不合法 | `ErrorResponse` |
| `401` | 未鉴权 | `ErrorResponse` |
| `409` | 设备离线或已被其他会话占用 | `ErrorResponse` |
| `503` | 设备服务正在停止或更新 | `ErrorResponse` |

#### 响应示例（`201`）

```json
{
  "id": "sess_abc123",
  "deviceId": "iphone-1",
  "expiresInMs": 30000
}
```

---

### 3. 续期会话

`POST /api/v1/sessions/{id}/heartbeat`

延长已有独占会话的租约有效期。

#### 路径参数

- `id`（`string`，必填）：会话 ID。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | 续期成功 | - |
| `401` | 未鉴权 | `ErrorResponse` |
| `410` | 会话已过期或已释放 | `ErrorResponse` |

---

### 4. 释放会话

`DELETE /api/v1/sessions/{id}`

主动结束独占控制会话，释放设备供其他客户端使用。

#### 路径参数

- `id`（`string`，必填）：会话 ID。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | 释放成功 | - |
| `401` | 未鉴权 | `ErrorResponse` |

---

### 5. 获取截图

`GET /api/v1/sessions/{id}/screenshot`

采集当前设备画面。默认返回包含 Base64 JPEG 的 JSON；若请求头指定 `Accept: image/jpeg`，则直接返回原始 JPEG 二进制流。

#### 路径参数

- `id`（`string`，必填）：会话 ID。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | 成功返回截图 | `ScreenFrame`（JSON）或 `image/jpeg` |
| `401` | 未鉴权 | `ErrorResponse` |
| `410` | 会话已过期或已释放 | `ErrorResponse` |

#### 响应示例（`200`，JSON）

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

### 6. 读取实时预览流

`GET /api/v1/sessions/{id}/preview`

当设备在 `Device.preview` 中声明支持 `'mjpeg'` 时，可通过该接口读取 `multipart/x-mixed-replace` 实时画面流。

#### 路径参数

- `id`（`string`，必填）：会话 ID。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | MJPEG 视频流 | `multipart/x-mixed-replace` |
| `401` | 未鉴权 | `ErrorResponse` |
| `404` | 设备不支持实时预览 | `ErrorResponse` |
| `410` | 会话已过期或已释放 | `ErrorResponse` |

---

### 7. 执行操作

`POST /api/v1/sessions/{id}/actions`

在当前会话中执行单次设备输入操作。操作类型必须包含在设备声明的 `Device.actions` 列表中。

#### 路径参数

- `id`（`string`，必填）：会话 ID。

#### 请求体

`InputAction` 联合类型（详见下文[数据模型](#inputaction)）。

#### 响应状态码

| 状态码 | 说明 | 返回类型 |
| --- | --- | --- |
| `200` | 操作执行完成 | - |
| `400` | 操作参数格式不合法 | `ErrorResponse` |
| `401` | 未鉴权 | `ErrorResponse` |
| `409` | 已有操作正在执行，或本次执行失败 | `ErrorResponse` |
| `410` | 会话已过期或已释放 | `ErrorResponse` |
| `422` | 设备不支持该操作类型 | `ErrorResponse` |

---

## 数据模型

### `Point`

```ts
type Point = {
  x: number; // 截图横坐标（像素）
  y: number; // 截图纵坐标（像素）
};
```

### `Device`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 设备唯一标识 |
| `name` | `string` | 是 | 设备显示名称 |
| `status` | `'available' \| 'busy' \| 'offline'` | 是 | 当前可用状态 |
| `actions` | `string[]` | 是 | 支持的操作类型列表 |
| `screenSource` | `'usb' \| 'camera' \| 'airplay'` | 否 | 画面采集来源 |
| `preview` | `'mjpeg'` | 否 | 支持实时预览时固定为 `'mjpeg'` |
| `inputGuidance` | `string` | 否 | 设备特定的输入提示信息 |

### `Session`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 会话 ID |
| `deviceId` | `string` | 是 | 绑定的设备 ID |
| `expiresInMs` | `integer` | 是 | 剩余租约时间（毫秒） |

### `ScreenFrame`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `jpeg` | `string`（base64） | 是 | Base64 编码的 JPEG 图片 |
| `width` | `integer` | 是 | 截图宽度（像素） |
| `height` | `integer` | 是 | 截图高度（像素） |
| `sequence` | `integer` | 是 | 帧序号 |
| `receivedAt` | `integer` | 是 | 采集时间戳（Unix 毫秒） |

### `InputAction`

按 `type` 字段区分的联合类型：

| `type` | 必填字段 | 可选字段与约束 | 说明 |
| --- | --- | --- | --- |
| `tap` | `point: Point` | - | 单击 |
| `doubleTap` | `point: Point` | - | 双击 |
| `longPress` | `point: Point` | `durationMs?: number`（`0`～`5000`） | 长按 |
| `swipe` | `from: Point`, `to: Point` | `durationMs?: number`（`0`～`5000`） | 滑动 |
| `dragAndDrop` | `from: Point`, `to: Point` | `durationMs?: number`（`0`～`5000`） | 拖拽 |
| `scroll` | `direction: 'up' \| 'down'` | `steps?: integer`（`1`～`24`），`point?: Point` | 滚动 |
| `typeText` | `text: string`（最长 `8192`） | `replace?: boolean` | 输入文本 |
| `clearInput` | - | - | 清空当前输入框 |
| `key` | `key: string`（长度 `1`～`128`） | - | 按键输入 |
| `home` | - | - | 返回主屏幕 |
| `back` | - | - | 返回上一级 |

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
    | 'SERVICE_UNAVAILABLE';
};
```
