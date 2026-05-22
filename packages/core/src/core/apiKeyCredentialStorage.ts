/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resets the API key cache. Used exclusively for test isolation.
 * @internal
 */
export function resetApiKeyCacheForTesting() {}

/**
 * Load cached API key
 */
export async function loadApiKey(): Promise<string | null> {
  return null;
}

/**
 * Save API key
 */
export async function saveApiKey(
  _apiKey: string | null | undefined,
): Promise<void> {}

/**
 * Clear cached API key
 */
export async function clearApiKey(): Promise<void> {}
