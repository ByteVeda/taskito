import { queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import { fetchTopicDetail, fetchTopics } from "./api";

const KEY = {
  all: ["topics"] as const,
  list: ["topics", "list"] as const,
  detail: (topic: string) => ["topics", "detail", topic] as const,
};

export function topicsQuery() {
  return queryOptions({
    queryKey: KEY.list,
    queryFn: ({ signal }) => fetchTopics(signal),
  });
}

export function topicDetailQuery(topic: string) {
  return queryOptions({
    queryKey: KEY.detail(topic),
    queryFn: ({ signal }) => fetchTopicDetail(topic, signal),
  });
}

export function useTopics() {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...topicsQuery(), refetchInterval: intervalMs });
}

export function useTopicDetail(topic: string) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...topicDetailQuery(topic), refetchInterval: intervalMs });
}
