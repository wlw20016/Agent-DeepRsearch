import React, { useState } from "react";
import { Alert, Button, Space } from "antd";
import type { Message } from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "humanInput" }>;
  onDecision: (actionId: string, decision: "approve" | "reject") => Promise<void>;
};

export const HumanInputMessage: React.FC<Props> = ({ message, onDecision }) => {
  const [loading, setLoading] = useState<"approve" | "reject" | null>(null);

  const handle = async (decision: "approve" | "reject") => {
    setLoading(decision);
    await onDecision(message.meta.actionId, decision);
    setLoading(null);
  };

  return (
    <Alert
      className="message hil-message"
      message="需要人工批准"
      description={
        <div>
          <div>{message.meta.reason}</div>
          <Space style={{ marginTop: 8 }}>
            <Button
              type="primary"
              loading={loading === "approve"}
              onClick={() => handle("approve")}
            >
              批准
            </Button>
            <Button danger loading={loading === "reject"} onClick={() => handle("reject")}>
              拒绝
            </Button>
          </Space>
        </div>
      }
      type="warning"
      showIcon
    />
  );
};
