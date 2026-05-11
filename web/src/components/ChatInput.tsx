import React, { useRef, useState } from "react";
import { Button, Input, Space } from "antd";
import { SendOutlined, PauseCircleOutlined, UploadOutlined } from "@ant-design/icons";

type Props = {
  onSend: (text: string) => void;
  onUpload?: (files: FileList) => void;
  placeholder?: string;
  initialText?: string;
  isStreaming?: boolean;
  isUploading?: boolean;
  onPause?: () => void;
};

export const ChatInput: React.FC<Props> = ({
  onSend,
  onUpload,
  placeholder,
  initialText,
  isStreaming = false,
  isUploading = false,
  onPause,
}) => {
  const [text, setText] = useState(initialText ?? "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  const handlePause = () => {
    onPause?.();
  };

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.target.files?.length) {
      onUpload?.(event.target.files);
    }
    event.target.value = "";
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
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept=".md,.txt,.html,.htm,.json"
        onChange={handleFileChange}
      />
      <Button
        loading={isUploading}
        icon={<UploadOutlined />}
        disabled={isStreaming}
        onClick={() => fileInputRef.current?.click()}
      >
        {"上传文档"}
      </Button>
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
