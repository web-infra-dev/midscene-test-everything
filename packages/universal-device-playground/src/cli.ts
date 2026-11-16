#!/usr/bin/env node
import { launchUniversalDevicePlayground } from './index.js';
const playground = await launchUniversalDevicePlayground();
process.once('SIGINT', () => void playground.close());
process.once('SIGTERM', () => void playground.close());
