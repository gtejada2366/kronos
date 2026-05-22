import axios, { AxiosResponse } from "axios";
import { CONFIG } from "./config";
import { log, sleep } from "./logger";
import { toDateStr } from "./dates";

/** Thrown when the GitHub API rate limit is fully exhausted. */
export class GitHubRateLimitError extends Error {}

interface SectionResult<T> {
  data: T;
  complete: boolean;
  note?: string;
}

const { owner, repo, apiBase, token } = CONFIG.github;

function headers(accept = "application/vnd.github+json"): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    "User-Agent": "elizaos-token-backtest",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghGet(
  url: string,
  params: Record<string, string | number> = {},
  accept?: string
): Promise<AxiosResponse> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await axios.get(url, {
      params,
      headers: headers(accept),
      timeout: 30000,
      validateStatus: () => true
    });

    const remaining = Number(res.headers["x-ratelimit-remaining"] ?? "1");

    if (res.status === 403 || res.status === 429) {
      if (remaining === 0) {
        const resetMs = Number(res.headers["x-ratelimit-reset"] ?? "0") * 1000;
        throw new GitHubRateLimitError(
          `GitHub rate limit exhausted; resets at ${
            resetMs ? new Date(resetMs).toISOString() : "unknown"
          }${token ? "" : " (set GITHUB_TOKEN to raise the limit to 5,000/hour)"}`
        );
      }
      // Secondary / abuse rate limit — back off and retry.
      const waitMs = 2000 * (attempt + 1);
      log.warn(`GitHub ${res.status}; backing off ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (res.status === 404) throw new Error(`GitHub 404: ${url}`);
    if (res.status >= 400) {
      throw new Error(`GitHub ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    return res;
  }
  throw new Error("GitHub request failed after retries");
}

function lastPageFromLink(linkHeader: unknown): number {
  if (typeof linkHeader !== "string") return 1;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="last"/);
    if (m) {
      const pageMatch = m[1].match(/[?&]page=(\d+)/);
      if (pageMatch) return parseInt(pageMatch[1], 10);
    }
  }
  return 1;
}

/** Daily commit counts within [sinceStr, untilStr] (inclusive UTC dates). */
export async function fetchCommits(
  sinceStr: string,
  untilStr: string
): Promise<SectionResult<{ counts: Map<string, number>; total: number }>> {
  const counts = new Map<string, number>();
  let total = 0;
  let complete = true;
  let note: string | undefined;
  const url = `${apiBase}/repos/${owner}/${repo}/commits`;

  for (let page = 1; page <= CONFIG.github.maxCommitPages; page++) {
    let res: AxiosResponse;
    try {
      res = await ghGet(url, {
        since: `${sinceStr}T00:00:00Z`,
        until: `${untilStr}T23:59:59Z`,
        per_page: 100,
        page
      });
    } catch (err) {
      complete = false;
      note = `commit fetch stopped at page ${page}: ${(err as Error).message}`;
      log.warn(note);
      break;
    }

    const arr = res.data as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) break;

    for (const c of arr) {
      const commit = c.commit as Record<string, unknown> | undefined;
      const committer = commit?.committer as Record<string, unknown> | undefined;
      const author = commit?.author as Record<string, unknown> | undefined;
      const dateIso = (committer?.date ?? author?.date) as string | undefined;
      if (!dateIso) continue;
      const d = toDateStr(new Date(dateIso));
      counts.set(d, (counts.get(d) ?? 0) + 1);
      total++;
    }

    if (arr.length < 100) break;
    if (page === CONFIG.github.maxCommitPages) {
      complete = false;
      note = `commit pagination hit cap of ${CONFIG.github.maxCommitPages} pages`;
      log.warn(note);
    }
    await sleep(CONFIG.github.interPageDelayMs);
  }

  return { data: { counts, total }, complete, note };
}

/** Daily release counts within the window. */
export async function fetchReleases(
  sinceStr: string,
  untilStr: string
): Promise<SectionResult<{ counts: Map<string, number>; total: number }>> {
  const counts = new Map<string, number>();
  let total = 0;
  let complete = true;
  let note: string | undefined;
  const url = `${apiBase}/repos/${owner}/${repo}/releases`;

  for (let page = 1; page <= 10; page++) {
    let res: AxiosResponse;
    try {
      res = await ghGet(url, { per_page: 100, page });
    } catch (err) {
      complete = false;
      note = `release fetch stopped: ${(err as Error).message}`;
      log.warn(note);
      break;
    }

    const arr = res.data as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) break;

    let allOlder = true;
    for (const r of arr) {
      const dateIso = (r.published_at ?? r.created_at) as string | undefined;
      if (!dateIso) continue;
      const d = toDateStr(new Date(dateIso));
      if (d >= sinceStr && d <= untilStr) {
        counts.set(d, (counts.get(d) ?? 0) + 1);
        total++;
      }
      if (d >= sinceStr) allOlder = false;
    }

    if (arr.length < 100 || allOlder) break;
    await sleep(CONFIG.github.interPageDelayMs);
  }

  return { data: { counts, total }, complete, note };
}

/**
 * Daily new-star counts since `sinceStr`. Stargazers are returned oldest-first,
 * so we discover the last page and walk backwards until a whole page predates
 * the window. Best-effort: caps pages and degrades gracefully on rate limits.
 */
export async function fetchStars(
  sinceStr: string
): Promise<SectionResult<{ deltas: Map<string, number>; total: number }>> {
  const deltas = new Map<string, number>();
  let total = 0;
  let complete = true;
  let note: string | undefined;
  const url = `${apiBase}/repos/${owner}/${repo}/stargazers`;
  const accept = "application/vnd.github.star+json";

  let lastPage = 1;
  try {
    const first = await ghGet(url, { per_page: 100, page: 1 }, accept);
    lastPage = lastPageFromLink(first.headers.link);
  } catch (err) {
    note = `star fetch unavailable: ${(err as Error).message}`;
    log.warn(note);
    return { data: { deltas, total: 0 }, complete: false, note };
  }

  let pagesFetched = 0;
  for (let page = lastPage; page >= 1; page--) {
    if (pagesFetched >= CONFIG.github.maxStarPages) {
      complete = false;
      note = `star pagination hit cap of ${CONFIG.github.maxStarPages} pages`;
      log.warn(note);
      break;
    }
    let res: AxiosResponse;
    try {
      res = await ghGet(url, { per_page: 100, page }, accept);
    } catch (err) {
      complete = false;
      note = `star fetch stopped at page ${page}: ${(err as Error).message}`;
      log.warn(note);
      break;
    }
    pagesFetched++;

    const arr = res.data as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) continue;

    let anyInWindow = false;
    for (const s of arr) {
      const starredAt = s.starred_at as string | undefined;
      if (!starredAt) continue;
      const d = toDateStr(new Date(starredAt));
      if (d >= sinceStr) {
        deltas.set(d, (deltas.get(d) ?? 0) + 1);
        total++;
        anyInWindow = true;
      }
    }
    // Walking newest→oldest: once an entire page predates the window, stop.
    if (!anyInWindow) break;
    await sleep(CONFIG.github.interPageDelayMs);
  }

  return { data: { deltas, total }, complete, note };
}

/** Daily new-fork counts since `sinceStr` (forks endpoint supports newest-first). */
export async function fetchForks(
  sinceStr: string
): Promise<SectionResult<{ deltas: Map<string, number>; total: number }>> {
  const deltas = new Map<string, number>();
  let total = 0;
  let complete = true;
  let note: string | undefined;
  const url = `${apiBase}/repos/${owner}/${repo}/forks`;

  for (let page = 1; page <= CONFIG.github.maxForkPages; page++) {
    let res: AxiosResponse;
    try {
      res = await ghGet(url, { sort: "newest", per_page: 100, page });
    } catch (err) {
      complete = false;
      note = `fork fetch stopped at page ${page}: ${(err as Error).message}`;
      log.warn(note);
      break;
    }

    const arr = res.data as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) break;

    let anyInWindow = false;
    for (const f of arr) {
      const createdAt = f.created_at as string | undefined;
      if (!createdAt) continue;
      const d = toDateStr(new Date(createdAt));
      if (d >= sinceStr) {
        deltas.set(d, (deltas.get(d) ?? 0) + 1);
        total++;
        anyInWindow = true;
      }
    }

    if (!anyInWindow || arr.length < 100) break;
    if (page === CONFIG.github.maxForkPages) {
      complete = false;
      note = `fork pagination hit cap of ${CONFIG.github.maxForkPages} pages`;
    }
    await sleep(CONFIG.github.interPageDelayMs);
  }

  return { data: { deltas, total }, complete, note };
}
