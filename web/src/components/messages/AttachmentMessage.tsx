import React, { useMemo, useState } from "react";
import { Card, Button, Space, Typography, Modal } from "antd";
import { DownloadOutlined, FileTextOutlined, LinkOutlined } from "@ant-design/icons";
import type { Message } from "../../types/messages";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

type Props = {
  message: Extract<Message, { type: "attachment" }>;
};

export const AttachmentMessage: React.FC<Props> = ({ message }) => {
  const downloadUrl = message.meta.url;
  const [viewerOpen, setViewerOpen] = useState(false);

  const decodedMarkdown = useMemo(() => {
    const prefix = "data:text/markdown;base64,";
    if (!downloadUrl.startsWith(prefix)) return null;
    try {
      const base64 = downloadUrl.slice(prefix.length);
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(bytes);
    } catch (err) {
      console.error("无法解析附件内容", err);
      return null;
    }
  }, [downloadUrl]);

  const handleView = () => {
    if (decodedMarkdown) {
      setViewerOpen(true);
    } else {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <Card size="small" className="message attachment-message" title="报告附件">
        <div className="attachment-row">
          <div className="attachment-info">
            <div className="attachment-name">
              <FileTextOutlined style={{ marginRight: 6 }} />
              {message.meta.name}
            </div>
            <div className="attachment-desc">{message.content || "报告已生成，可下载查看。"}</div>
            <Typography.Link
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="attachment-link"
            >
              可下载链接
            </Typography.Link>
          </div>
          <Space>
            <Button icon={<LinkOutlined />} onClick={handleView}>
              在线查看
            </Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href={downloadUrl}
              download={message.meta.name}
              target="_blank"
              rel="noreferrer"
            >
              下载
            </Button>
          </Space>
        </div>
      </Card>
      <Modal
        title={message.meta.name}
        open={viewerOpen}
        onCancel={() => setViewerOpen(false)}
        footer={null}
        width={960}
        bodyStyle={{ maxHeight: "70vh", overflow: "auto" }}
      >
        {decodedMarkdown ? (
          <div className="markdown-body attachment-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {decodedMarkdown}
            </ReactMarkdown>
          </div>
        ) : (
          <iframe
            title="preview"
            src={downloadUrl}
            style={{ width: "100%", height: "70vh", border: "none" }}
          />
        )}
      </Modal>
    </>
  );
};
