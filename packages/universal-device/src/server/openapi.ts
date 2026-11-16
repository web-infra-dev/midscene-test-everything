const sessionIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};
const sessionSecurity = [{ deviceToken: [] }];
const errorContent = {
  'application/json': {
    schema: { $ref: '#/components/schemas/ErrorResponse' },
  },
};

export const openAPI = {
  openapi: '3.0.3',
  info: { title: 'Midscene Universal Device API', version: '0.1.0' },
  components: {
    securitySchemes: { deviceToken: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Point: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', description: 'X coordinate in screenshot pixels' },
          y: { type: 'number', description: 'Y coordinate in screenshot pixels' },
        },
      },
      Device: {
        type: 'object',
        required: ['id', 'name', 'status', 'actions'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['available', 'busy', 'offline'] },
          screenSource: { type: 'string', enum: ['usb', 'camera', 'airplay'] },
          actions: { type: 'array', items: { type: 'string' } },
          preview: { type: 'string', enum: ['mjpeg'] },
          inputGuidance: { type: 'string' },
        },
      },
      Session: {
        type: 'object',
        required: ['id', 'deviceId', 'expiresInMs'],
        properties: {
          id: { type: 'string' },
          deviceId: { type: 'string' },
          expiresInMs: { type: 'integer' },
        },
      },
      ScreenFrame: {
        type: 'object',
        required: ['jpeg', 'width', 'height', 'sequence', 'receivedAt'],
        properties: {
          jpeg: { type: 'string', format: 'byte', description: 'Base64-encoded JPEG' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          sequence: { type: 'integer' },
          receivedAt: { type: 'integer', description: 'Unix timestamp in milliseconds' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string' },
          code: {
            type: 'string',
            enum: [
              'UNAUTHORIZED',
              'NOT_FOUND',
              'INVALID_REQUEST',
              'PAYLOAD_TOO_LARGE',
              'DEVICE_BUSY',
              'DEVICE_OFFLINE',
              'ACTION_IN_PROGRESS',
              'ACTION_UNSUPPORTED',
              'ACTION_FAILED',
              'SESSION_EXPIRED',
              'PREVIEW_UNAVAILABLE',
              'SERVICE_STOPPING',
              'SERVICE_UPDATING',
              'SERVICE_UNAVAILABLE',
            ],
          },
        },
      },
      InputAction: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: { type: { type: 'string', enum: ['home'] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: { type: { type: 'string', enum: ['back'] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: { type: { type: 'string', enum: ['clearInput'] } },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'point'],
            properties: {
              type: { type: 'string', enum: ['tap'] },
              point: { $ref: '#/components/schemas/Point' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'direction'],
            properties: {
              type: { type: 'string', enum: ['scroll'] },
              direction: { type: 'string', enum: ['up', 'down'] },
              steps: { type: 'integer', minimum: 1, maximum: 24 },
              point: { $ref: '#/components/schemas/Point' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'point'],
            properties: {
              type: { type: 'string', enum: ['doubleTap'] },
              point: { $ref: '#/components/schemas/Point' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'point'],
            properties: {
              type: { type: 'string', enum: ['longPress'] },
              point: { $ref: '#/components/schemas/Point' },
              durationMs: { type: 'number', minimum: 0, maximum: 5000 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'from', 'to'],
            properties: {
              type: { type: 'string', enum: ['dragAndDrop'] },
              from: { $ref: '#/components/schemas/Point' },
              to: { $ref: '#/components/schemas/Point' },
              durationMs: { type: 'number', minimum: 0, maximum: 5000 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'from', 'to'],
            properties: {
              type: { type: 'string', enum: ['swipe'] },
              from: { $ref: '#/components/schemas/Point' },
              to: { $ref: '#/components/schemas/Point' },
              durationMs: { type: 'number', minimum: 0, maximum: 5000 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'text'],
            properties: {
              type: { type: 'string', enum: ['typeText'] },
              text: { type: 'string', maxLength: 8192 },
              replace: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'key'],
            properties: {
              type: { type: 'string', enum: ['key'] },
              key: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
        ],
        discriminator: { propertyName: 'type' },
      },
    },
  },
  paths: {
    '/api/v1/sessions': {
      post: {
        summary: 'Acquire exclusive control of a ready device',
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['deviceId'],
                properties: {
                  deviceId: { type: 'string', minLength: 1, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Device control lease',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Session' },
              },
            },
          },
          '400': { description: 'Invalid request', content: errorContent },
          '401': { description: 'Unauthorized', content: errorContent },
          '409': { description: 'Device offline or in use', content: errorContent },
          '503': { description: 'Device service stopping or updating', content: errorContent },
        },
      },
    },
    '/api/v1/sessions/{id}': {
      parameters: [sessionIdParameter],
      delete: {
        summary: 'Release device control',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Released' },
          '401': { description: 'Unauthorized', content: errorContent },
        },
      },
    },
    '/api/v1/sessions/{id}/heartbeat': {
      parameters: [sessionIdParameter],
      post: {
        summary: 'Renew device control lease',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Renewed' },
          '401': { description: 'Unauthorized', content: errorContent },
          '410': { description: 'Control session ended', content: errorContent },
        },
      },
    },
    '/api/v1/sessions/{id}/screenshot': {
      parameters: [sessionIdParameter],
      get: {
        summary: 'Capture a device screenshot',
        description:
          'Returns JSON with base64 JPEG by default, or raw JPEG bytes when Accept: image/jpeg is requested.',
        security: sessionSecurity,
        responses: {
          '200': {
            description: 'Screenshot frame',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ScreenFrame' },
              },
              'image/jpeg': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '401': { description: 'Unauthorized', content: errorContent },
          '410': { description: 'Control session ended', content: errorContent },
        },
      },
    },
    '/api/v1/sessions/{id}/preview': {
      parameters: [sessionIdParameter],
      get: {
        summary: 'Stream the latest preview frames for a device',
        security: sessionSecurity,
        responses: {
          '200': {
            description: 'MJPEG preview stream',
            content: { 'multipart/x-mixed-replace': {} },
          },
          '401': { description: 'Unauthorized', content: errorContent },
          '404': { description: 'Device has no live preview', content: errorContent },
          '410': { description: 'Control session ended', content: errorContent },
        },
      },
    },
    '/api/v1/sessions/{id}/actions': {
      parameters: [sessionIdParameter],
      post: {
        summary: 'Execute one device action',
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InputAction' },
            },
          },
        },
        responses: {
          '200': { description: 'Action completed' },
          '400': { description: 'Invalid action', content: errorContent },
          '401': { description: 'Unauthorized', content: errorContent },
          '409': { description: 'Another action is in progress or execution failed', content: errorContent },
          '410': { description: 'Control session ended', content: errorContent },
          '422': { description: 'Device does not support this action', content: errorContent },
        },
      },
    },
    '/api/v1/devices': {
      get: {
        summary: 'List configured device profiles',
        description:
          'Authenticate with a Bearer token configured on the device service.',
        security: [{ deviceToken: [] }],
        responses: {
          '200': {
            description: 'Configured device profiles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['devices'],
                  properties: {
                    devices: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Device' },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid access token', content: errorContent },
          '503': { description: 'Device backend unavailable', content: errorContent },
        },
      },
    },
  },
};
