import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export type LeaderboardCategory =
  | "restaurant_earnings"
  | "crops_harvested"
  | "fish_caught"
  | "help_actions_given"
  | "steals_attempted";

export interface FeedEvent {
  id: string;
  neighbourhood_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  trigger_player_id: string | null;
  created_at: string;
  expires_at: string;
  timeAgoString: string;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  displayName: string | null;
  score: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  playerRank: number;
  playerScore: number;
  category: LeaderboardCategory;
}

interface PlayerNeighbourhoodRow {
  id?: string;
  display_name?: string | null;
  neighbourhood_id: string | null;
  lifetime_stats?: Record<string, unknown> | null;
}

interface NeighbourhoodMemberRow {
  player_id: string;
}

interface NeighbourhoodFeedRow {
  id: string;
  neighbourhood_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  trigger_player_id: string | null;
  created_at: string;
  expires_at: string;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  in(column: string, values: string[]): PlayerQuery;
  order(column: string, options: { ascending: boolean }): PlayerQuery;
  single(): Promise<
    { data: PlayerNeighbourhoodRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: PlayerNeighbourhoodRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerNeighbourhoodRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface NeighbourhoodMemberQuery {
  select(columns: string): NeighbourhoodMemberQuery;
  eq(column: string, value: string): NeighbourhoodMemberQuery;
  then<
    TResult1 = {
      data: NeighbourhoodMemberRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: NeighbourhoodMemberRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface NeighbourhoodFeedQuery {
  select(columns: string): NeighbourhoodFeedQuery;
  eq(column: string, value: string): NeighbourhoodFeedQuery;
  gt(column: string, value: string): NeighbourhoodFeedQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): NeighbourhoodFeedQuery;
  range(from: number, to: number): NeighbourhoodFeedQuery;
  insert(values: Record<string, unknown>): NeighbourhoodFeedQuery;
  then<
    TResult1 = {
      data: NeighbourhoodFeedRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: NeighbourhoodFeedRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const FEED_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Adds a neighbourhood feed event for a player, silently skipping players with no neighbourhood.
 * @param triggerPlayerId - Player whose neighbourhood receives the event.
 * @param eventType - Feed event type.
 * @param data - JSON event payload.
 * @returns Nothing.
 * @throws DB_ERROR when a database operation fails.
 */
export async function addNeighbourhoodFeedEvent(
  triggerPlayerId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("neighbourhood_id")
      .eq("id", triggerPlayerId)
      .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player?.neighbourhood_id) return;

  const now = Math.floor(Date.now() / 1000);
  const { error } =
    await (supabaseAdmin.from("neighbourhood_feed") as NeighbourhoodFeedQuery)
      .insert({
        neighbourhood_id: player.neighbourhood_id,
        event_type: eventType,
        event_data: data,
        trigger_player_id: triggerPlayerId,
        expires_at: new Date((now + FEED_TTL_SECONDS) * 1000).toISOString(),
      });
  if (error) throw new Error("DB_ERROR:" + error.message);
}

/**
 * Adds a level milestone feed event when the new level qualifies.
 * @param playerId - Player who reached the level.
 * @param level - New player level.
 * @returns Nothing.
 * @throws DB_ERROR when the feed insert fails.
 */
export async function addLevelMilestoneFeedEvent(
  playerId: string,
  level: number,
): Promise<void> {
  // SPEC_AMBIGUITY: Task 7.4 only says level 15 is not a feed event and level 20 is; the full milestone cadence is unspecified. V1 treats multiples of 20 as level milestones.
  if (level % 20 !== 0) return;
  await addNeighbourhoodFeedEvent(playerId, "LEVEL_MILESTONE", { level });
}

/**
 * Returns unexpired neighbourhood feed events visible to the player.
 * @param playerId - Player requesting their feed.
 * @param limit - Maximum number of events to return.
 * @param offset - Pagination offset.
 * @returns Feed events with timeAgoString.
 * @throws DB_ERROR when a database operation fails.
 */
export async function getNeighbourhoodFeed(
  playerId: string,
  limit = 20,
  offset = 0,
): Promise<FeedEvent[]> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("neighbourhood_id")
      .eq("id", playerId)
      .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player?.neighbourhood_id) return [];

  const now = new Date().toISOString();
  const { data, error } =
    await (supabaseAdmin.from("neighbourhood_feed") as NeighbourhoodFeedQuery)
      .select("*")
      .eq("neighbourhood_id", player.neighbourhood_id)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
  if (error) throw new Error("DB_ERROR:" + error.message);

  return (data ?? []).map((event) => ({
    ...event,
    timeAgoString: formatTimeAgo(event.created_at),
  }));
}

/**
 * Returns top-ten leaderboard entries for a player's neighbourhood and the requesting player's rank.
 * @param playerId - Player requesting the leaderboard.
 * @param category - Lifetime stat category.
 * @returns Leaderboard result.
 * @throws NOT_IN_NEIGHBOURHOOD when the player is not in a neighbourhood.
 * @throws DB_ERROR when a database operation fails.
 */
export async function getNeighbourhoodLeaderboard(
  playerId: string,
  category: LeaderboardCategory,
): Promise<LeaderboardResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("neighbourhood_id")
      .eq("id", playerId)
      .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player?.neighbourhood_id) throw new Error("NOT_IN_NEIGHBOURHOOD");

  const { data: members, error: membersError } = await (supabaseAdmin.from(
    "neighbourhood_members",
  ) as NeighbourhoodMemberQuery)
    .select("player_id")
    .eq("neighbourhood_id", player.neighbourhood_id);
  if (membersError) throw new Error("DB_ERROR:" + membersError.message);

  const memberIds = (members ?? []).map((member) => member.player_id);
  // SPEC_AMBIGUITY: Task 7.4 category is "restaurant_earnings", but the documented players.lifetime_stats key is "restaurant_earnings_lifetime".
  const storedCategory = category === "restaurant_earnings"
    ? "restaurant_earnings_lifetime"
    : category;
  const statKey = `lifetime_stats->>${storedCategory}`;
  const { data: scores, error: scoresError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("id, display_name, lifetime_stats")
      .in("id", memberIds)
      .order(statKey, { ascending: false });
  if (scoresError) throw new Error("DB_ERROR:" + scoresError.message);

  const sorted = (scores ?? []).map((score, index) => ({
    rank: index + 1,
    playerId: score.id ?? "",
    displayName: score.display_name ?? null,
    score: Number(score.lifetime_stats?.[storedCategory] ?? 0),
  }));
  const top10 = sorted.slice(0, 10);
  const playerEntry = sorted.find((entry) => entry.playerId === playerId);
  return {
    entries: top10,
    playerRank: playerEntry?.rank ?? sorted.length + 1,
    playerScore: playerEntry?.score ?? 0,
    category,
  };
}

/**
 * Formats an ISO timestamp as a compact relative time string.
 * @param createdAtIso - ISO timestamp to format.
 * @returns Relative age string.
 * @throws Never.
 */
export function formatTimeAgo(createdAtIso: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(createdAtIso)) / 1000),
  );
  if (elapsedSeconds < 60) return "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Handles HTTP requests for the neighbourhood feed Edge Function.
 * @param request - Incoming request with action-specific JSON fields.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "addNeighbourhoodFeedEvent") {
      await addNeighbourhoodFeedEvent(
        String(body.triggerPlayerId ?? ""),
        String(body.eventType ?? ""),
        (body.data ?? {}) as Record<string, unknown>,
      );
      return Response.json({ success: true });
    }
    if (action === "getNeighbourhoodFeed") {
      return Response.json(
        await getNeighbourhoodFeed(
          String(body.playerId ?? ""),
          Number(body.limit ?? 20),
          Number(body.offset ?? 0),
        ),
      );
    }
    if (action === "getNeighbourhoodLeaderboard") {
      return Response.json(
        await getNeighbourhoodLeaderboard(
          String(body.playerId ?? ""),
          String(body.category ?? "") as LeaderboardCategory,
        ),
      );
    }

    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
