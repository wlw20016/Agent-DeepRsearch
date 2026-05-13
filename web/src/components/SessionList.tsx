import React from "react";
import { Button, List, Space, Typography } from "antd";
import { CloseOutlined, PlusOutlined } from "@ant-design/icons";
import type { Session } from "../types/messages";

type Props = {
  sessions: Session[];
  activeId: string;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
};

export const SessionList: React.FC<Props> = ({
  sessions,
  activeId,
  onCreate,
  onSelect,
  onClose,
}) => {
  return (
    <div className="session-list">
      <Space style={{ marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          会话
        </Typography.Title>
        <Button size="small" icon={<PlusOutlined />} onClick={onCreate}>
          新建
        </Button>
      </Space>
      <List
        size="small"
        dataSource={sessions}
        renderItem={(session) => (
          <List.Item
            className={`session-item ${session.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(session.id)}
          >
            <div className="session-main">
              <div className="session-title">{session.title || "未命名会话"}</div>
              <div className="session-time">
                {new Date(session.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </div>
            </div>
            <Button
              type="text"
              size="small"
              className="session-close"
              icon={<CloseOutlined />}
              aria-label="关闭会话"
              title="关闭会话"
              onClick={(event) => {
                event.stopPropagation();
                onClose(session.id);
              }}
            />
          </List.Item>
        )}
      />
    </div>
  );
};
