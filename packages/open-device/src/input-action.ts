import { z } from 'zod';

const point = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
const durationMs = z.number().min(0).max(5000).optional();
export const inputAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('home') }).strict(),
  z.object({ type: z.literal('back') }).strict(),
  z.object({ type: z.literal('clearInput') }).strict(),
  z.object({ type: z.literal('tap'), point }).strict(),
  z
    .object({
      type: z.literal('longPress'),
      point,
      durationMs,
    })
    .strict(),
  z
    .object({
      type: z.literal('dragAndDrop'),
      from: point,
      to: point,
      durationMs,
    })
    .strict(),
  z
    .object({
      type: z.literal('swipe'),
      from: point,
      to: point,
      durationMs,
    })
    .strict(),
  z
    .object({
      type: z.literal('typeText'),
      text: z.string().max(8192),
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('key'), key: z.string().min(1).max(128) })
    .strict(),
]);
export type InputAction = z.infer<typeof inputAction>;
