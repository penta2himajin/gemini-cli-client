import { randomUUID } from 'node:crypto';
import type {
  PartListUnion,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import type { AgentLoopContext } from '../config/agent-loop-context.js';
import type { HistoryTurn } from '../core/agentChatHistory.js';
import {
  type ToolCallRecord,
  type ConversationRecordExtra,
  type ConversationRecord,
  type ResumedSessionData,
  type LoadConversationOptions,
} from './chatRecordingTypes.js';
export * from './chatRecordingTypes.js';

export async function loadConversationRecord(
  _filePath: string,
  _options?: LoadConversationOptions,
): Promise<ConversationRecord> {
  return {
    sessionId: '',
    projectHash: '',
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    messages: [],
  };
}

export class ChatRecordingService {
  constructor(_context: AgentLoopContext) {}

  async initialize(
    _resumedSessionData?: ResumedSessionData,
    _kind?: 'main' | 'subagent',
  ): Promise<void> {}

  recordMessage(message: {
    model: string | undefined;
    type: ConversationRecordExtra['type'];
    content: PartListUnion;
    displayContent?: PartListUnion;
    id?: string;
  }): string {
    return message.id || randomUUID();
  }

  recordSyntheticMessage(
    _type: ConversationRecordExtra['type'],
    _content: PartListUnion,
    id?: string,
  ): string {
    return id || randomUUID();
  }

  recordThought(_thought: any): void {}

  recordMessageTokens(
    _respUsageMetadata: GenerateContentResponseUsageMetadata,
  ): void {}

  recordToolCalls(_model: string, _toolCalls: ToolCallRecord[]): void {}

  saveSummary(_summary: string): void {}

  recordDirectories(_directories: readonly string[]): void {}

  getConversation(): ConversationRecord | null {
    return null;
  }

  getConversationFilePath(): string | null {
    return null;
  }

  async deleteSession(_sessionIdOrBasename: string): Promise<void> {}

  async deleteCurrentSessionAsync(): Promise<void> {}

  rewindTo(_messageId: string): ConversationRecord | null {
    return null;
  }

  updateMessagesFromHistory(_history: readonly HistoryTurn[]): void {}
}
