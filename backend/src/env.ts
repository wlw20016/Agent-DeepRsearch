import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY ?? "",
  },
};
