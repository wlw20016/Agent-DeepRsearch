import React from "react";
import { Button, List, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Session } from "../types/messages";

type Props = {
  sessions: Session[];
  activeId: string;
  onCreate: () => void;
  onSelect: (id: string) => void;
};

export const SessionList: React.FC<Props> = ({ sessions, activeId, onCreate, onSelect }) => {
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
        renderItem={(s) => (
          <List.Item
            className={`session-item ${s.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="session-title">{s.title || "未命名会话"}</div>
            <div className="session-time">
              {new Date(s.createdAt).toLocaleString("zh-CN", { hour12: false })}
            </div>
          </List.Item>
        )}
      />
    </div>
  );
};
