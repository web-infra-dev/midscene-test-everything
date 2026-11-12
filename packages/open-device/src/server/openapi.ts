const sessionIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};
const sessionSecurity = [{ deviceToken: [] }];

export const openAPI = {
  openapi: '3.0.3',
  info: { title: 'Midscene Open Device API', version: '0.1.0' },
  components: {
    securitySchemes: { deviceToken: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Device: {
        type: 'object',
        required: ['id', 'name', 'status', 'actions'],
        properties: {
          actions: { type: 'array', items: { type: 'string' } },
          preview: { type: 'string', enum: ['mjpeg'] },
          id: { type: 'string' },
          name: { type: 'string' },
          screenSource: { type: 'string', enum: ['usb', 'camera', 'airplay'] },
          status: { type: 'string', enum: ['available', 'busy', 'offline'] },
        },
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
                required: ['deviceId'],
                properties: { deviceId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Device control lease' },
          '409': { description: 'Device offline or in use' },
          '503': { description: 'Device service stopping or updating' },
        },
      },
    },
    '/api/v1/sessions/{id}': {
      parameters: [sessionIdParameter],
      delete: {
        summary: 'Release device control',
        security: sessionSecurity,
        responses: { '200': { description: 'Released' } },
      },
    },
    '/api/v1/sessions/{id}/heartbeat': {
      parameters: [sessionIdParameter],
      post: {
        summary: 'Renew device control lease',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Renewed' },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/sessions/{id}/screenshot': {
      parameters: [sessionIdParameter],
      get: {
        summary: 'Capture a device screenshot',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Base64 JPEG and frame metadata' },
          '410': { description: 'Control session ended' },
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
          '410': { description: 'Control session ended' },
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
              schema: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'home',
                      'back',
                      'tap',
                      'swipe',
                      'longPress',
                      'dragAndDrop',
                      'clearInput',
                      'typeText',
                      'key',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Action completed' },
          '400': { description: 'Invalid action' },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/devices': {
      get: {
        summary: 'List saved device profiles',
        description:
          'Get the access token on the Mac with iphone-use token. A phone is available after it is connected in the device manager.',
        security: [{ deviceToken: [] }],
        responses: {
          '200': {
            description: 'Saved device profiles',
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
          '401': { description: 'Missing or invalid access token' },
          '503': { description: 'Device backend unavailable' },
        },
      },
    },
  },
};
