/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type AgentLoopContext,
  Config,
  type ConfigParameters,
  AuthType,
  PREVIEW_GEMINI_MODEL_AUTO,
  GeminiEventType,
  type ToolCallRequestInfo,
  type ServerGeminiStreamEvent,
  type GeminiClient,
  type Content,
  scheduleAgentTools,
  getAuthTypeFromEnv,
  type ToolRegistry,
  loadSkillsFromDir,
  ActivateSkillTool,
  type ResumedSessionData,
  PolicyDecision,
} from '@google/gemini-cli-core';

import { type Tool, SdkTool } from './tool.js';
import { SdkAgentFilesystem } from './fs.js';
import { SdkAgentShell } from './shell.js';
import type {
  SessionContext,
  GeminiCliAgentOptions,
  SystemInstructions,
} from './types.js';
import type { SkillReference } from './skills.js';
import type { GeminiCliAgent } from './agent.js';

/**
 * Represents an interactive conversation session with a Gemini CLI agent.
 *
 * A session manages the conversation lifecycle: initialization, sending messages
 * via streaming, handling tool calls, and maintaining conversation history.
 *
 * Create a session via {@link GeminiCliAgent.session} or resume one with
 * {@link GeminiCliAgent.resumeSession}.
 */
export class GeminiCliSession {
  private readonly config: Config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools: Array<Tool<any>>;
  private readonly skillRefs: SkillReference[];
  private readonly instructions: SystemInstructions | undefined;
  private client: GeminiClient | undefined;
  private initialized = false;

  constructor(
    options: GeminiCliAgentOptions,
    private readonly sessionId: string,
    private readonly agent: GeminiCliAgent,
    private readonly resumedData?: ResumedSessionData,
  ) {
    this.instructions = options.instructions;
    const cwd = options.cwd || process.cwd();
    this.tools = options.tools || [];
    this.skillRefs = options.skills || [];

    let initialMemory = '';
    if (typeof this.instructions === 'string') {
      initialMemory = this.instructions;
    } else if (this.instructions && typeof this.instructions !== 'function') {
      throw new Error('Instructions must be a string or a function.');
    }

    const configParams: ConfigParameters = {
      sessionId: this.sessionId,
      targetDir: cwd,
      cwd,
      debugMode: options.debug ?? false,
      model: options.model || PREVIEW_GEMINI_MODEL_AUTO,
      userMemory: initialMemory,
      // Minimal config
      enableHooks: false,
      mcpEnabled: false,
      extensionsEnabled: false,
      recordResponses: options.recordResponses,
      fakeResponses: options.fakeResponses,
      skillsSupport: true,
      adminSkillsEnabled: true,
      policyEngineConfig: {
        // TODO: Revisit this default when we have a mechanism for wiring up approvals
        defaultDecision: PolicyDecision.ALLOW,
      },
    };

    this.config = new Config(configParams);
  }

  /**
   * The unique identifier for this session.
   */
  get id(): string {
    return this.sessionId;
  }

  /**
   * Initialize the session by setting up authentication, loading skills,
   * and registering tools. Must be called before {@link sendStream}.
   *
   * This method is idempotent — calling it multiple times has no effect
   * after the first successful initialization.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const authType = getAuthTypeFromEnv() || AuthType.COMPUTE_ADC;

    await this.config.refreshAuth(authType);
    await this.config.initialize();

    // Load additional skills from options
    if (this.skillRefs.length > 0) {
      const skillManager = this.config.getSkillManager();

      const loadPromises = this.skillRefs.map(async (ref) => {
        try {
          if (ref.type === 'dir') {
            return await loadSkillsFromDir(ref.path);
          }
        } catch (e) {
          // TODO: refactor this to use a proper logger interface
          // eslint-disable-next-line no-console
          console.error(`Failed to load skills from ${ref.path}:`, e);
        }
        return [];
      });

      const loadedSkills = (await Promise.all(loadPromises)).flat();

      if (loadedSkills.length > 0) {
        skillManager.addSkills(loadedSkills);
      }
    }

    // Re-register ActivateSkillTool if we have skills
    const skillManager = this.config.getSkillManager();
    if (skillManager.getSkills().length > 0) {
      const loopContext: AgentLoopContext = this.config;
      const registry = loopContext.toolRegistry;
      const toolName = ActivateSkillTool.Name;
      if (registry.getTool(toolName)) {
        registry.unregisterTool(toolName);
      }
      registry.registerTool(
        new ActivateSkillTool(this.config, loopContext.messageBus),
      );
    }

    // Register tools
    const loopContext2: AgentLoopContext = this.config;
    const registry = loopContext2.toolRegistry;
    const messageBus = loopContext2.messageBus;

    for (const toolDef of this.tools) {
      const sdkTool = new SdkTool(toolDef, messageBus, this.agent, undefined);
      registry.registerTool(sdkTool);
    }

    this.client = loopContext2.geminiClient;

    if (this.resumedData) {
      const history: Content[] = this.resumedData.conversation.messages.map(
        (m) => {
          const role = m.type === 'gemini' ? 'model' : 'user';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let parts: any[] = [];
          if (Array.isArray(m.content)) {
            parts = m.content;
          } else if (m.content) {
            parts = [{ text: String(m.content) }];
          }
          return { role, parts };
        },
      );
      await this.client.resumeChat(history, this.resumedData);
    }

    this.initialized = true;
  }

  /**
   * Update the session configuration dynamically.
   *
   * @param updates - An object containing the configuration properties to update.
   */
  async updateConfig(updates: {
    model?: string;
    memory_reload?: boolean;
    skills_reload?: boolean;
  }): Promise<void> {
    if (updates.model) {
      this.config.setModel(updates.model);
      // Ensure the client is aware of the model change if it's already initialized
      this.client?.updateSystemInstruction();
    }
    if (updates.memory_reload) {
      await this.config.getMemoryContextManager()?.refresh();
      this.client?.updateSystemInstruction();
    }
    if (updates.skills_reload) {
      await this.config.reloadSkills();
    }
  }

  /**
   * Run a slash command on the server.
   *
   * @param raw - The raw command string (e.g., "/model set gemini-1.5-pro")
   */
  async *runCommand(
    raw: string,
  ): AsyncGenerator<ServerGeminiStreamEvent, void, unknown> {
    const trimmed = raw.trim();
    if (trimmed.startsWith('/model set ')) {
      const model = trimmed.split(' ')[2];
      if (model) {
        await this.updateConfig({ model });
        yield {
          type: GeminiEventType.Content,
          value: `Model updated to ${model} (via server)`,
        };
      }
    } else if (trimmed === '/memory reload' || trimmed === '/memory refresh') {
      await this.updateConfig({ memory_reload: true });
      yield {
        type: GeminiEventType.Content,
        value: 'Memory reloaded from source files on server.',
      };
    } else if (trimmed === '/agents reload' || trimmed === '/agents refresh') {
      await this.updateConfig({ skills_reload: true });
      yield {
        type: GeminiEventType.Content,
        value: 'Agent skills reloaded on server.',
      };
    } else if (trimmed === '/clear') {
      this.client?.setHistory([]);
      yield {
        type: GeminiEventType.Content,
        value: 'Conversation history cleared on server.',
      };
    } else if (trimmed === '/help' || trimmed === '?') {
      yield {
        type: GeminiEventType.Content,
        value: `Available server-side commands:
- /model set <name>: Switch AI model
- /memory reload: Refresh context files (GEMINI.md)
- /agents reload: Refresh skills and agents
- /clear: Reset conversation history
- /help: Show this help message`,
      };
    } else {
      // For unsupported commands, just return an error for now
      yield {
        type: GeminiEventType.Content,
        value: `Command "${raw}" is not yet supported for server-side execution.`,
      };
    }
  }

  /**
   * Send a prompt to the model and yield streaming events as they arrive.
   *
   * Handles the full agentic loop: sends the user prompt, streams model
   * responses, executes any tool calls the model requests, and continues
   * the loop until the model produces a final response with no tool calls.
   *
   * @param prompt - The user message to send.
   * @param signal - Optional {@link AbortSignal} to cancel the stream.
   * @yields {@link ServerGeminiStreamEvent} events as they are received from
   *   the model.
   *
   * @example
   * ```typescript
   * for await (const event of session.sendStream('Explain this code')) {
   *   if (event.type === GeminiEventType.ModelResponse) {
   *     process.stdout.write(event.value);
   *   }
   * }
   * ```
   */
  async *sendStream(
    prompt: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (!this.initialized || !this.client) {
      await this.initialize();
    }
    const client = this.client!;
    const abortSignal = signal ?? new AbortController().signal;
    const sessionId = this.config.getSessionId();

    const fs = new SdkAgentFilesystem(this.config);
    const shell = new SdkAgentShell(this.config);

    let request: Parameters<GeminiClient['sendMessageStream']>[0] = [
      { text: prompt },
    ];

    while (true) {
      if (typeof this.instructions === 'function') {
        const context: SessionContext = {
          sessionId,
          transcript: client.getHistory(),
          cwd: this.config.getWorkingDir(),
          timestamp: new Date().toISOString(),
          fs,
          shell,
          agent: this.agent,
          session: this,
        };
        const newInstructions = await this.instructions(context);
        this.config.setUserMemory(newInstructions);
        client.updateSystemInstruction();
      }

      const stream = client.sendMessageStream(request, abortSignal, sessionId);

      const toolCallsToSchedule: ToolCallRequestInfo[] = [];

      for await (const event of stream) {
        yield event;
        if (event.type === GeminiEventType.ToolCallRequest) {
          const toolCall = event.value;
          let args = toolCall.args;
          if (typeof args === 'string') {
            args = JSON.parse(args) as Record<string, unknown>;
          }
          toolCallsToSchedule.push({
            ...toolCall,
            args: args as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id: sessionId,
          });
        }
      }

      if (toolCallsToSchedule.length === 0) {
        break;
      }

      const transcript: readonly Content[] = client.getHistory();
      const context: SessionContext = {
        sessionId,
        transcript,
        cwd: this.config.getWorkingDir(),
        timestamp: new Date().toISOString(),
        fs,
        shell,
        agent: this.agent,
        session: this,
      };

      const loopContext: AgentLoopContext = this.config;
      const originalRegistry = loopContext.toolRegistry;
      const scopedRegistry: ToolRegistry = originalRegistry.clone();
      const originalGetTool = scopedRegistry.getTool.bind(scopedRegistry);
      scopedRegistry.getTool = (name: string) => {
        const tool = originalGetTool(name);
        if (tool instanceof SdkTool) {
          return tool.bindContext(context);
        }
        return tool;
      };

      const completedCalls = await scheduleAgentTools(
        this.config,
        toolCallsToSchedule,
        {
          schedulerId: sessionId,
          toolRegistry: scopedRegistry,
          signal: abortSignal,
        },
      );

      const functionResponses = completedCalls.flatMap(
        (call) => call.response.responseParts,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      request = functionResponses as unknown as Parameters<
        GeminiClient['sendMessageStream']
      >[0];
    }
  }
}
