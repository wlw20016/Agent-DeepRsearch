import axios from "axios";
import { config } from "../env.js";
import { TavilyResult } from "../types.js";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export async function tavilySearch(query: string): Promise<TavilyResult[]> {
  if (!config.tavily.apiKey) {
    return [
      {
        title: "演示搜索结果",
        url: "https://example.com/demo",
        content: `示例搜索结果用于离线演示。查询词：“${query}”。请配置 TAVILY_API_KEY 以获取真实数据。`,
      },
    ];
  }

  const { data } = await axios.post(
    TAVILY_ENDPOINT,
    {
      api_key: config.tavily.apiKey,
      query,
      search_depth: "advanced",
      max_results: 30,
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 20_000,
    }
  );

  const results = (data?.results ?? []) as any[];
  return results.map((item) => ({
    title: item.title,
    url: item.url,
    content: item.content ?? item.snippet ?? "",
  }));
}
