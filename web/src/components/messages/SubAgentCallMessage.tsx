import React from "react";
import { Card, Tag } from "antd";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "subAgentCall" }>;
};

export const SubAgentCallMessage: React.FC<Props> = ({ message }) => {
  return (
    <Card size="small" className="message subagent-message" title="SubAgent 调用">
      <div className="subagent-top">
        <Tag color="cyan">{message.meta.agent}</Tag>
        <span className="subagent-task">{message.meta.task}</span>
      </div>
      <div className="subagent-content">{message.content}</div>
    </Card>
  );
};
