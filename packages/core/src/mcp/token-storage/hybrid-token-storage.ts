/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTokenStorage } from './base-token-storage.js';
import type { OAuthCredentials } from './types.js';

export class HybridTokenStorage extends BaseTokenStorage {
  constructor(serviceName: string) {
    super(serviceName);
  }

  async getCredentials(_serverName: string): Promise<OAuthCredentials | null> {
    return null;
  }

  async setCredentials(_credentials: OAuthCredentials): Promise<void> {}

  async deleteCredentials(_serverName: string): Promise<void> {}

  async listServers(): Promise<string[]> {
    return [];
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return new Map();
  }

  async clearAll(): Promise<void> {}

  async getStorageType(): Promise<any> {
    return null;
  }
}
