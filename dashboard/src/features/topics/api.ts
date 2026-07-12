import { api } from "@/lib/api-client";
import type { SubscriptionBacklog, TopicSummary } from "@/lib/api-types";

export function fetchTopics(signal?: AbortSignal): Promise<TopicSummary[]> {
  return api.get<TopicSummary[]>("/api/topics", { signal });
}

export function fetchTopicDetail(
  topic: string,
  signal?: AbortSignal,
): Promise<SubscriptionBacklog[]> {
  return api.get<SubscriptionBacklog[]>(`/api/topics/${encodeURIComponent(topic)}`, { signal });
}
