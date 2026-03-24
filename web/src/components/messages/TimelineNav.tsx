import React from "react";
import { Timeline, Typography, Tooltip, Empty } from "antd";
import type { Message } from "../../types/messages";

type Props = {
  /** 完整的会话消息列表 */
  messages: Message[];
};

export const TimelineNav: React.FC<Props> = ({ messages }) => {
  // 架构核心 1：数据源派生 (Derived State)
  // 从所有消息中，精准过滤出代表节点的 "用户纯文本提问"
  const userMessages = messages.filter(
    (m) => m.role === "user" && m.type === "text"
  );

  // 架构核心 2：原生 DOM 滚动调度
  const scrollToMessage = (id: string) => {
    const element = document.getElementById(`chat-msg-${id}`);
    if (element) {
      // 利用原生 API 接管视图滚动，smooth 开启平滑过渡
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Typography.Title 
        level={5} 
        style={{ marginTop: 8, marginBottom: 24, color: '#333' }}
      >
        对话时间线
      </Typography.Title>
      
      {userMessages.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无提问" />
      ) : (
        <div style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
          {/* Ant Design 5+ 推荐使用 items 属性传参 */}
          <Timeline
            items={userMessages.map((msg) => {
              const text = typeof msg.content === 'string' ? msg.content : '';
              // 提取摘要：超过 15 个字符则截断显示省略号
              const abstract = text.length > 15 ? text.slice(0, 15) + '...' : text;
              
              return {
                color: 'blue',
                children: (
                  <Tooltip title={text} placement="left">
                    <div 
                      style={{ 
                        cursor: "pointer", 
                        color: "#666", 
                        transition: "color 0.3s", 
                        fontSize: "13px" 
                      }}
                      onClick={() => scrollToMessage(msg.id)}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#1677ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
                    >
                      {abstract}
                    </div>
                  </Tooltip>
                )
              };
            })}
          />
        </div>
      )}
    </div>
  );
};