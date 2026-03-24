import React, { useState } from "react";
import { Card, Descriptions } from "antd";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "toolResult" }>;
};

export const ToolResultMessage: React.FC<Props> = ({ message }) => {
  const [open, setOpen] = useState(false);
  return (
    <Card
      size="small"
      className="message toolresult-message"
      title={`[结果] ${message.meta.tool}`}
      extra={<a onClick={() => setOpen((v) => !v)}>{open ? "收起" : "展开"}</a>}
    >
      <div>{message.content}</div>
      {open && (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="原始结果">
            <pre className="preblock">{JSON.stringify(message.meta.result, null, 2)}</pre>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  );
};
