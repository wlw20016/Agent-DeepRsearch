import { v4 as uuid } from "uuid";
import { chatStream } from "../llm.js";
import { SSEClient, endTextStream, startTextStream, streamTokens } from "../sse.js";
import { RetrievedSource } from "../types.js";

export type ProcessingResult = {
  insights: string;
};

type ProcessingOptions = {
  streamToUser?: boolean;
};

async function* tapStream(
  stream: AsyncGenerator<string, void, unknown>,
  onToken: (token: string) => void
) {
  for await (const token of stream) {
    onToken(token);
    yield token;
  }
}

export async function runInformationProcessing(
  client: SSEClient,
  prompt: string,
  results: RetrievedSource[],
  options: ProcessingOptions = {}
): Promise<ProcessingResult> {
  const formatted = results
    .map(
      (source, index) =>
        `${index + 1}. [${source.sourceType.toUpperCase()}] ${source.title}\n${source.content}\nSource: ${
          source.url ?? "N/A"
        }`
    )
    .join("\n\n");

  const messageId = uuid();
  const baseMessage = { id: messageId, role: "agent" as const };
  const streamToUser = options.streamToUser ?? true;
  let insights = "";

  const responseStream = chatStream(
    [
      {
        role: "system",
        content:
          "You are an information processing agent. Merge and deduplicate retrieved sources, distinguish KB and WEB evidence, flag conflicts, and produce key insights, actionable conclusions, and important data points.",
      } as any,
      {
        role: "human",
        content: `User task:\n${prompt}\n\nRaw sources:\n${formatted}`,
      } as any,
    ],
    client.abortController.signal
  );

  if (streamToUser) {
    startTextStream(client, baseMessage, "Processing complete. Insights:\n");
    await streamTokens(
      client,
      baseMessage,
      tapStream(responseStream, (token) => {
        insights += token;
      })
    );
    endTextStream(client, baseMessage);
  } else {
    for await (const token of responseStream) {
      insights += token;
    }
  }

  return { insights };
}
