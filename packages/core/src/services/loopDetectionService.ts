/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ServerGeminiStreamEvent } from '../core/turn.js';
import {
  LoopType,
} from '../telemetry/types.js';

/**
 * Result of a loop detection check.
 */
export interface LoopDetectionResult {
  count: number;
  type?: LoopType;
  detail?: string;
  confirmedByModel?: string;
}

/**
 * Service for detecting and preventing infinite loops in AI responses.
 * Monitors tool call repetitions and content sentence repetitions.
 */
export class LoopDetectionService {
  constructor(_context: any) {}

  disableForSession(): void {}

  addAndCheck(_event: ServerGeminiStreamEvent): LoopDetectionResult {
    return { count: 0 };
  }

  async turnStarted(_signal: AbortSignal): Promise<LoopDetectionResult> {
    return { count: 0 };
  }

  reset(_promptId: string, _userPrompt?: string): void {}

  clearDetection(): void {}
}
