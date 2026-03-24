import React from "react";
import { Card, Tooltip } from "antd";
import { CopyOutlined, EditOutlined, RedoOutlined } from "@ant-design/icons";
import type { Message } from "../types/messages";
import { TextMessage } from "./messages/TextMessage";
import { SubAgentCallMessage } from "./messages/SubAgentCallMessage";
import { ToolCallMessage } from "./messages/ToolCallMessage";
import { ToolResultMessage } from "./messages/ToolResultMessage";
import { AttachmentMessage } from "./messages/AttachmentMessage";
import { HumanInputMessage } from "./messages/HumanInputMessage";

type Props = {
  message: Message;
  onResend: (text: string) => void;
  onRetry: (message: Message) => void;
  onDecision: (actionId: string, decision: "approve" | "reject") => Promise<void>;
};

export const MessageRenderer: React.FC<Props> = ({ message, onResend, onRetry, onDecision }) => {
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const render = () => {
    switch (message.type) {
      case "text":
        return <TextMessage message={message} />;
      case "subAgentCall":
        return <SubAgentCallMessage message={message} />;
      case "toolCall":
        return <ToolCallMessage message={message} />;
      case "toolResult":
        return <ToolResultMessage message={message} />;
      case "attachment":
        return <AttachmentMessage message={message} />;
      case "humanInput":
        return <HumanInputMessage message={message} onDecision={onDecision} />;
      default:
        return null;
    }
  };

  const renderActions = () => {
    const actions = [];
    if (message.type === "text" && message.role === "user") {
      actions.push(
        <Tooltip title="编辑重发" key="edit">
          <EditOutlined onClick={() => onResend(message.content)} />
        </Tooltip>
      );
      actions.push(
        <Tooltip title="重试" key="retry">
          <RedoOutlined onClick={() => onRetry(message)} />
        </Tooltip>
      );
      actions.push(
        <Tooltip title="复制" key="copy">
          <CopyOutlined onClick={() => copy(message.content)} />
        </Tooltip>
      );
    }
    return actions;
  };

  const userInlineActions =
    message.type === "text" && message.role === "user" ? renderActions() : undefined;
  const cardActions =
    message.type === "text" && message.role === "user"
      ? undefined
      : (() => {
          const acts = renderActions();
          return acts.length ? acts : undefined;
        })();

  return (
    <Card
      className="message-card"
      size="small"
      bodyStyle={{ padding: 12 }}
      actions={cardActions}
      bordered={false}
    >
      {message.type === "text" ? (
        <TextMessage message={message} actions={userInlineActions} />
      ) : (
        render()
      )}
    </Card>
  );
};
