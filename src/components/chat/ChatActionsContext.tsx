import { createContext } from "react";

export type ChatActions = {
  updateChartTimeframe: (messageId: string, partIndex: number, timeframe: string) => Promise<void>;
  sendCommand: (command: string, args: Record<string, any>, userLabel: string) => Promise<void>;
};

export const ChatActionsContext = createContext<ChatActions | null>(null);
