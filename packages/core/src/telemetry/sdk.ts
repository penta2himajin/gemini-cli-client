/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JWTInput } from 'google-auth-library';
import type { Config } from '../config/config.js';

export function isTelemetrySdkInitialized(): boolean {
  return false;
}

export function bufferTelemetryEvent(_fn: () => void | Promise<void>): void {}

export async function initializeTelemetry(
  _config: Config,
  _credentials?: JWTInput,
): Promise<void> {}

export async function flushTelemetry(_config: Config): Promise<void> {}

export async function shutdownTelemetry(
  _config: Config,
  _fromProcessExit = true,
): Promise<void> {}
