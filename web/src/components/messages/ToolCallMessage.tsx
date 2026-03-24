import React, { useState } from "react";
import { Card, Descriptions } from "antd";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "toolCall" }>;
};

export const ToolCallMessage: React.FC<Props> = ({ message }) => {
  const [open, setOpen] = useState(false);
  return (
    <Card
      size="small"
      className="message toolcall-message"
      title={`[执行] ${message.meta.tool}`}
      extra={<a onClick={() => setOpen((v) => !v)}>{open ? "收起" : "展开"}</a>}
    >
      <div>{message.content}</div>
      {open && (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="工具">{message.meta.tool}</Descriptions.Item>
          <Descriptions.Item label="输入">
            <pre className="preblock">{JSON.stringify(message.meta.input, null, 2)}</pre>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  );
};
