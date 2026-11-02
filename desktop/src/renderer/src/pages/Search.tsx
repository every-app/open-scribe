import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SearchScreen, type SearchResults } from "@talk/ui";
import { api, cleanError, keys } from "../api";
import { searchable, tabFor } from "../search";

const TYPING_PAUSE_MS = 250;

export function SearchPage({ q }: { q: string }) {
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const [settled, setSettled] = useState(q.trim());

  // Search once typing pauses, and keep the query in the URL (back returns to it).
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    if (settled !== q.trim()) void navigate({ to: "/search", search: settled ? { q: settled } : {}, replace: true });
    // Only when what was typed settles; a new q from outside is taken below.
  }, [settled]);
  // Back/forward or the sidebar's Search (a fresh box): take the URL's q.
  useEffect(() => {
    if (q.trim() !== settled) {
      setText(q);
      setSettled(q.trim());
    }
  }, [q]);

  const enabled = searchable(settled);
  const query = useInfiniteQuery({
    queryKey: keys.search(settled),
    queryFn: ({ pageParam }) => api.search(settled, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    // While a new query loads, keep the last results on screen instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  });

  const results: SearchResults = !settled
    ? { status: "idle" }
    : !enabled
      ? { status: "ready", data: { results: [], hasMore: false } }
      : query.isPending
        ? { status: "loading" }
        : query.isError
          ? { status: "error", message: cleanError(query.error) }
          : {
              status: "ready",
              data: { results: query.data.pages.flatMap((p) => p.results), hasMore: !!query.hasNextPage },
            };

  return (
    <SearchScreen
      query={text}
      onQueryChange={setText}
      results={results}
      onOpen={(result) => {
        const tab = tabFor(result.field);
        void navigate({ to: "/meetings/$id", params: { id: result.meeting.id }, search: tab ? { tab } : {} });
      }}
      onLoadMore={() => void query.fetchNextPage()}
      loadingMore={query.isFetchingNextPage}
      onRetry={() => void query.refetch()}
    />
  );
}
