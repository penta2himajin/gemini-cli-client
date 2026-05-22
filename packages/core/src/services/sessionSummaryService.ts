import type { BaseLlmClient } from '../core/baseLlmClient.js';
import {
  type MessageRecord,
} from './chatRecordingTypes.js';

/**
 * Options for generating a session summary.
 */
export interface GenerateSummaryOptions {
  messages: MessageRecord[];
  maxMessages?: number;
  timeout?: number;
}

/**
 * Service for generating AI summaries of chat sessions.
 */
export class SessionSummaryService {
  constructor(_baseLlmClient: BaseLlmClient) {}

  /**
   * Generate a 1-line summary of a chat session focusing on user intent.
   * Returns null if generation fails for any reason.
   */
  async generateSummary(
    _options: GenerateSummaryOptions,
  ): Promise<string | null> {
    return null;
  }
}
