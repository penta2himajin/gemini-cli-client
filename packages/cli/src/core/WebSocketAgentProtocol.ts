import { WebSocket } from 'ws';
import {
  type AgentProtocol,
  type AgentEvent,
  type AgentSend,
  type Unsubscribe,
  debugLogger,
} from '@google/gemini-cli-core';

interface ServerEvent {
  type: 'text_delta' | 'tool_start' | 'tool_output' | 'turn_complete' | 'error' | 'metadata_updated' | 'config_updated' | 'session_list';
  payload: any;
  sessionId?: string;
}

export class WebSocketAgentProtocol implements AgentProtocol {
  private _events: AgentEvent[] = [];
  private _subscribers = new Set<(event: AgentEvent) => void>();
  private ws: WebSocket;
  private sessionId: string;
  private messageQueue: string[] = [];
  private isConnected = false;
  
  private currentStreamId: string = `ws-stream-${Date.now()}`;

  constructor(url: string, sessionId: string) {
    this.sessionId = sessionId;
    
    // Add clientType and sessionId to URL
    const wsUrl = new URL(url);
    wsUrl.searchParams.set('clientType', 'cli');
    wsUrl.searchParams.set('sessionId', sessionId);

    this.ws = new WebSocket(wsUrl.toString());
    
    this.ws.on('open', () => {
      this.isConnected = true;
      debugLogger.debug('WebSocketAgentProtocol: Connected to remote server');
      // Flush queue
      for (const msg of this.messageQueue) {
        this.ws.send(msg);
      }
      this.messageQueue = [];
    });

    this.ws.on('message', (data) => {
      try {
        const rawEvent = JSON.parse(data.toString()) as ServerEvent;
        this.handleServerEvent(rawEvent);
      } catch (e) {
        debugLogger.error('Failed to parse WS message', e);
      }
    });

    this.ws.on('close', () => {
      debugLogger.debug('WebSocketAgentProtocol: Connection closed');
      this.isConnected = false;
    });

    this.ws.on('error', (err) => {
      debugLogger.error('WebSocketAgentProtocol: Connection error', err);
    });
  }

  get events(): readonly AgentEvent[] {
    return this._events;
  }

  subscribe(callback: (event: AgentEvent) => void): Unsubscribe {
    this._subscribers.add(callback);
    return () => {
      this._subscribers.delete(callback);
    };
  }

  async send(payload: AgentSend): Promise<{ streamId: string }> {
    const streamId = `ws-stream-${Date.now()}`;
    this.currentStreamId = streamId;

    if ('message' in payload && payload.message) {
      const messagePayload = payload.message;
      let text = messagePayload.displayContent || '';
      
      if (!text && messagePayload.content) {
        text = messagePayload.content.map(c => {
          if ('text' in c) return (c as { text: string }).text;
          return '';
        }).join('');
      }

      const msg = JSON.stringify({
        type: 'chat_message',
        payload: { sessionId: this.sessionId, text }
      });

      if (this.isConnected) {
        this.ws.send(msg);
      } else {
        this.messageQueue.push(msg);
      }
      
      // Emit agent_start immediately so the UI knows we are running
      this.dispatchEvent({
        id: `evt-${Date.now()}`,
        streamId,
        timestamp: new Date().toISOString(),
        type: 'agent_start'
      });
    }

    if ('update' in payload && payload.update) {
      const msg = JSON.stringify({
        type: 'update_config',
        payload: { sessionId: this.sessionId, updates: payload.update }
      });

      if (this.isConnected) {
        this.ws.send(msg);
      } else {
        this.messageQueue.push(msg);
      }
    }
    
    return { streamId };
  }

  async abort(): Promise<void> {
    // Currently unsupported by the simple API server
  }

  private dispatchEvent(event: AgentEvent) {
    this._events.push(event);
    for (const sub of this._subscribers) {
      sub(event);
    }
  }

  private handleServerEvent(serverEvent: ServerEvent) {
    const streamId = this.currentStreamId;
    const baseEvent = {
      id: `evt-${Date.now()}-${Math.random()}`,
      streamId,
      timestamp: new Date().toISOString(),
    };
    
    switch (serverEvent.type) {
      case 'text_delta':
        this.dispatchEvent({
          ...baseEvent,
          type: 'message',
          role: 'agent',
          content: [{ type: 'text', text: serverEvent.payload.text as string }]
        } as AgentEvent);
        break;

      case 'tool_start': {
        const toolName = (serverEvent.payload.toolName as string) || 'unknown_tool';
        this.dispatchEvent({
          ...baseEvent,
          type: 'tool_request',
          requestId: `req_${Date.now()}`,
          name: toolName,
          args: (serverEvent.payload.args as Record<string, unknown>) || {},
          display: { name: toolName }
        } as unknown as AgentEvent);
        break;
      }

      case 'tool_output':
        this.dispatchEvent({
          ...baseEvent,
          type: 'tool_response',
          requestId: `req_${Date.now()}`,
          name: 'unknown_tool', // API Server payload missing toolName, so we mock it. 
          result: serverEvent.payload.result as string,
        } as unknown as AgentEvent);
        break;

      case 'turn_complete':
        this.dispatchEvent({
          ...baseEvent,
          type: 'agent_end',
          reason: 'STOP'
        } as unknown as AgentEvent);
        break;

      case 'error':
        this.dispatchEvent({
          ...baseEvent,
          type: 'error',
          status: 'error',
          message: serverEvent.payload.message as string,
          fatal: false,
          error: new Error(serverEvent.payload.message as string)
        } as unknown as AgentEvent);
        break;
      
      case 'metadata_updated':
      case 'config_updated':
      case 'session_list':
        // No UI action needed for these
        break;

      default:
        // Handle unexpected event types
        debugLogger.warn(`WebSocketAgentProtocol: Unhandled server event type: ${(serverEvent as any).type}`);
    }
  }
}
