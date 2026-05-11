import React, { useMemo, useState } from "react";
import { Button, Empty, Input, List, Popconfirm, Space, Tag, Typography } from "antd";
import { DeleteOutlined, EyeOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";

export type KnowledgeItem = {
  name: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  updatedAt: number;
  supported: boolean;
  extension: string;
  tags: string[];
};

export type KnowledgeDetail = KnowledgeItem & {
  content: string;
};

type Props = {
  items: KnowledgeItem[];
  loading?: boolean;
  refreshingAll?: boolean;
  busyPath?: string | null;
  previewPath?: string | null;
  previewLoading?: boolean;
  previewItem?: KnowledgeDetail | null;
  onRefresh: () => void;
  onReingestAll: () => void;
  onReingestOne: (path: string) => void;
  onDeleteOne: (path: string) => void;
  onPreview: (path: string) => void;
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export const KnowledgePanel: React.FC<Props> = ({
  items,
  loading = false,
  refreshingAll = false,
  busyPath = null,
  previewPath = null,
  previewLoading = false,
  previewItem = null,
  onRefresh,
  onReingestAll,
  onReingestOne,
  onDeleteOne,
  onPreview,
}) => {
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string>("all");

  const tags = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((item) => item.tags.forEach((tag) => unique.add(tag)));
    return ["all", ...Array.from(unique).sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword =
        !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        item.relativePath.toLowerCase().includes(keyword);
      const matchesTag = activeTag === "all" || item.tags.includes(activeTag);
      return matchesKeyword && matchesTag;
    });
  }, [activeTag, items, search]);

  return (
    <div className="knowledge-panel">
      <Space className="knowledge-panel-header" align="center">
        <Typography.Title level={5} style={{ margin: 0 }}>
          知识库
        </Typography.Title>
        <Tag color="cyan">{items.length} 个文档</Tag>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Button size="small" onClick={onRefresh} loading={loading && !refreshingAll}>
          刷新列表
        </Button>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<ReloadOutlined />}
          onClick={onReingestAll}
          loading={refreshingAll}
        >
          全量重建
        </Button>
      </Space>

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索文件名或路径"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 12 }}
      />

      <div className="knowledge-tags">
        {tags.map((tag) => (
          <Tag
            key={tag}
            className={`knowledge-filter-tag ${activeTag === tag ? "active" : ""}`}
            color={activeTag === tag ? "blue" : "default"}
            onClick={() => setActiveTag(tag)}
          >
            {tag === "all" ? "全部" : tag}
          </Tag>
        ))}
      </div>

      <List
        size="small"
        loading={loading}
        locale={{ emptyText: "暂无匹配的知识库文档" }}
        dataSource={filteredItems}
        className="knowledge-list"
        renderItem={(item) => {
          const busy = busyPath === item.relativePath;
          const previewing = previewPath === item.relativePath;
          return (
            <List.Item
              className="knowledge-item"
              actions={[
                <Button
                  key="preview"
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  loading={previewLoading && previewing}
                  onClick={() => onPreview(item.relativePath)}
                >
                  预览
                </Button>,
                <Button
                  key="reingest"
                  type="text"
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={busy}
                  onClick={() => onReingestOne(item.relativePath)}
                >
                  重建
                </Button>,
                <Popconfirm
                  key="delete"
                  title="删除这个文档？"
                  description="会同时删除本地文件和向量库记录。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => onDeleteOne(item.relativePath)}
                >
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} loading={busy}>
                    删除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<span className="knowledge-item-name">{item.name}</span>}
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary" className="knowledge-item-path">
                      {item.relativePath}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {formatSize(item.size)} ·{" "}
                      {new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />

      <div className="knowledge-preview">
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
          文档预览
        </Typography.Title>

        {previewItem ? (
          <>
            <Space wrap style={{ marginBottom: 8 }}>
              <Typography.Text strong>{previewItem.name}</Typography.Text>
              {previewItem.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </Space>
            <Typography.Paragraph type="secondary" className="knowledge-preview-meta">
              {previewItem.relativePath}
            </Typography.Paragraph>
            <pre className="knowledge-preview-content">{previewItem.content}</pre>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={previewLoading ? "正在加载预览..." : "选择一个文档查看预览"}
          />
        )}
      </div>
    </div>
  );
};
