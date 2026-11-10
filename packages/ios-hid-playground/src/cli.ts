#!/usr/bin/env node
import { launchIOSHIDPlayground } from './index.js';
const playground = await launchIOSHIDPlayground();
process.once('SIGINT', () => void playground.close());
process.once('SIGTERM', () => void playground.close());
