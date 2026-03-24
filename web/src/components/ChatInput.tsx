import React, { useState } from "react";
import { Button, Input, Space } from "antd";
import { SendOutlined, PauseCircleOutlined } from "@ant-design/icons";

type Props = {
  onSend: (text: string) => void;
  placeholder?: string;
  initialText?: string;
  isStreaming?: boolean;
  onPause?: () => void;
};

export const ChatInput: React.FC<Props> = ({
  onSend,
  placeholder,
  initialText,
  isStreaming = false,
  onPause,
}) => {
  const [text, setText] = useState(initialText ?? "");

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  const handlePause = () => {
    onPause?.();
  };

  return (
    <Space.Compact className="chat-input">
      <Input.TextArea
        value={text}
        autoSize={{ minRows: 1, maxRows: 4 }}
        placeholder={placeholder ?? "\u8f93\u5165\u95ee\u9898\uff0c\u652f\u6301 Markdown"}
        onChange={(e) => setText(e.target.value)}
        onPressEnter={(e) => {
          if (!e.shiftKey && !isStreaming) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={isStreaming}
      />
      {isStreaming ? (
        <Button danger icon={<PauseCircleOutlined />} onClick={handlePause}>
          {"\u6682\u505c"}
        </Button>
      ) : (
        <Button type="primary" icon={<SendOutlined />} onClick={handleSend}>
          {"\u53d1\u9001"}
        </Button>
      )}
    </Space.Compact>
  );
};
