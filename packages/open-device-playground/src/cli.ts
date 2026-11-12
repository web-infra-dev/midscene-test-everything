#!/usr/bin/env node
import { launchOpenDevicePlayground } from './index.js';
const playground = await launchOpenDevicePlayground();
process.once('SIGINT', () => void playground.close());
process.once('SIGTERM', () => void playground.close());
