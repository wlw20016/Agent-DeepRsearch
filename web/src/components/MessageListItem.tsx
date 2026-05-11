import React from "react";
import { MessageRenderer } from "./MessageRenderer";
import type { Message } from "../types/messages";

type Props = {
  message: Message;
  onResend: (text: string) => void;
  onRetry: (message: Message) => void;
  onDecision: (actionId: string, decision: "approve" | "reject") => Promise<void>;
};

function MessageListItemComponent({ message, onResend, onRetry, onDecision }: Props) {
  return (
    <div id={`chat-msg-${message.id}`}>
      <MessageRenderer
        message={message}
        onResend={onResend}
        onRetry={onRetry}
        onDecision={onDecision}
      />
    </div>
  );
}

export const MessageListItem = React.memo(MessageListItemComponent);
 