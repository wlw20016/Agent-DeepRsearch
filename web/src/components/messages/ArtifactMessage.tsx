import React from "react";
import { Tag } from "antd";
import type {
  ChartArtifactSpec,
  Message,
  TableArtifactSpec,
  VisualArtifact,
} from "../../types/messages";

type Props = {
  message: Extract<Message, { type: "artifact" }>;
};

function isChartSpec(spec: VisualArtifact["spec"]): spec is ChartArtifactSpec {
  return "chartType" in spec;
}

function valueLabel(value: string | number | null | undefined) {
  return value === null || value === undefined ? "-" : String(value);
}

function numericValue(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getChartFields(spec: ChartArtifactSpec) {
  const first = spec.data[0] ?? {};
  const keys = Object.keys(first);
  const xField = spec.xField || keys.find((key) => key !== spec.yField) || keys[0] || "label";
  const yField =
    spec.yField ||
    keys.find((key) => typeof first[key] === "number") ||
    keys.find((key) => key !== xField) ||
    "value";

  return { xField, yField };
}

const BarChart: React.FC<{ spec: ChartArtifactSpec }> = ({ spec }) => {
  const { xField, yField } = getChartFields(spec);
  const values = spec.data.map((item) => numericValue(item[yField]));
  const max = Math.max(...values, 1);

  return (
    <div className="artifact-bars">
      {spec.data.map((item, index) => {
        const value = numericValue(item[yField]);
        const width = `${Math.max(4, (value / max) * 100)}%`;
        return (
          <div className="artifact-bar-row" key={`${valueLabel(item[xField])}-${index}`}>
            <div className="artifact-bar-label">{valueLabel(item[xField])}</div>
            <div className="artifact-bar-track">
              <div className="artifact-bar-fill" style={{ width }} />
              <span className="artifact-bar-value">
                {valueLabel(item[yField])}
                {spec.unit ? ` ${spec.unit}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LineChart: React.FC<{ spec: ChartArtifactSpec }> = ({ spec }) => {
  const { xField, yField } = getChartFields(spec);
  const width = 640;
  const height = 220;
  const padding = 28;
  const values = spec.data.map((item) => numericValue(item[yField]));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  const points = spec.data.map((item, index) => {
    const x =
      padding + (index / Math.max(1, spec.data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((numericValue(item[yField]) - min) / range) * (height - padding * 2);
    return { x, y, label: valueLabel(item[xField]), value: valueLabel(item[yField]) };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className="artifact-line-wrap">
      <svg className="artifact-line" viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} />
        <path d={path} />
        {points.map((point) => (
          <g key={`${point.label}-${point.x}`}>
            <circle cx={point.x} cy={point.y} r="4" />
            <text x={point.x} y={height - 6} textAnchor="middle">
              {point.label}
            </text>
            <text x={point.x} y={point.y - 8} textAnchor="middle">
              {point.value}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
};

const PieChart: React.FC<{ spec: ChartArtifactSpec }> = ({ spec }) => {
  const { xField, yField } = getChartFields(spec);
  const total = spec.data.reduce((sum, item) => sum + Math.max(0, numericValue(item[yField])), 0) || 1;

  return (
    <div className="artifact-pie-list">
      {spec.data.map((item, index) => {
        const value = Math.max(0, numericValue(item[yField]));
        const percent = Math.round((value / total) * 100);
        return (
          <div className="artifact-pie-row" key={`${valueLabel(item[xField])}-${index}`}>
            <span className="artifact-pie-dot" style={{ background: `hsl(${index * 58}, 62%, 45%)` }} />
            <span>{valueLabel(item[xField])}</span>
            <strong>{percent}%</strong>
          </div>
        );
      })}
    </div>
  );
};

const TableArtifact: React.FC<{ spec: TableArtifactSpec }> = ({ spec }) => (
  <div className="artifact-table-wrap">
    <table className="artifact-table">
      <thead>
        <tr>
          {spec.columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {spec.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {spec.columns.map((column, columnIndex) => (
              <td key={`${column}-${columnIndex}`}>{valueLabel(row[columnIndex])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ChartArtifact: React.FC<{ spec: ChartArtifactSpec }> = ({ spec }) => {
  if (spec.chartType === "line" || spec.chartType === "scatter") return <LineChart spec={spec} />;
  if (spec.chartType === "pie") return <PieChart spec={spec} />;
  return <BarChart spec={spec} />;
};

export const ArtifactMessage: React.FC<Props> = ({ message }) => {
  const artifact = message.meta.artifact;

  return (
    <div className="message artifact-message">
      <div className="artifact-header">
        <Tag color="cyan">{artifact.type === "chart" ? "CHART" : "TABLE"}</Tag>
        <div>
          <div className="artifact-title">{artifact.title}</div>
          {artifact.description && <div className="artifact-description">{artifact.description}</div>}
        </div>
      </div>
      {isChartSpec(artifact.spec) ? (
        <ChartArtifact spec={artifact.spec} />
      ) : (
        <TableArtifact spec={artifact.spec} />
      )}
      {artifact.sourceIds.length > 0 && (
        <div className="artifact-sources">Sources: {artifact.sourceIds.join(", ")}</div>
      )}
    </div>
  );
};
