import {
  getPlayerProfile,
  type PublicPlayerProfile,
} from "../get-player-profile/index.ts";
import {
  type AnimalRecord,
  calculateAnimalHappiness,
  getAnimalConfig,
} from "../lib/animals.ts";
import type { FarmPlot } from "../lib/farm.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";
import { sendNotification } from "../steal/index.ts";
import type { FishingTrap } from "../traps/index.ts";

export interface RequestResult {
  success: true;
  requestId: string;
}

export interface AcceptResult {
  success: true;
  newFriendId: string;
}

export interface FriendEntry extends PublicPlayerProfile {
  has_help_needed: boolean;
}

interface FriendRequestRow {
  id: string;
  from_id: string;
  to_id: string;
  status: "pending" | "accepted" | "declined";
  sent_at?: string;
}

interface FriendshipRow {
  player_id: string;
  friend_id: string;
  created_at?: string;
}

interface PlayerHelpRow {
  farm_plots?: FarmPlot[] | null;
  animals?: Record<string, AnimalRecord> | null;
  fishing_traps?: FishingTrap[] | null;
}

interface FriendRequestQuery {
  select(columns: string): FriendRequestQuery;
  eq(column: string, value: string): FriendRequestQuery;
  insert(values: Record<string, unknown>): FriendRequestQuery;
  update(values: Record<string, unknown>): FriendRequestQuery;
  single(): Promise<
    { data: FriendRequestRow | null; error: { message: string } | null }
  >;
  maybeSingle(): Promise<
    { data: FriendRequestRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: FriendRequestRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: FriendRequestRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface FriendshipQuery {
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): FriendshipQuery;
  eq(column: string, value: string): FriendshipQuery;
  or(expression: string): FriendshipQuery;
  insert(values: Array<Record<string, unknown>>): FriendshipQuery;
  delete(): FriendshipQuery;
  then<
    TResult1 = {
      data: FriendshipRow[] | null;
      error: { message: string } | null;
      count?: number | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: FriendshipRow[] | null;
          error: { message: string } | null;
          count?: number | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface PlayerHelpQuery {
  select(columns: string): PlayerHelpQuery;
  eq(column: string, value: string): PlayerHelpQuery;
  single(): Promise<
    { data: PlayerHelpRow | null; error: { message: string } | null }
  >;
}

/**
 * Sends a pending friend request and notifies the target player.
 * @param fromId - Player creating the friend request.
 * @param toId - Player receiving the friend request.
 * @returns Success result containing the created request id.
 * @throws CANNOT_FRIEND_SELF when a player targets themself.
 * @throws ALREADY_FRIENDS when both friendship rows already exist.
 * @throws ALREADY_SENT when a pending same-direction request already exists.
 * @throws DB_ERROR when a database operation fails.
 */
export async function sendFriendRequest(
  fromId: string,
  toId: string,
): Promise<RequestResult> {
  if (fromId === toId) throw new Error("CANNOT_FRIEND_SELF");

  const already = await isMutualFriend(fromId, toId);
  if (already) throw new Error("ALREADY_FRIENDS");

  const { data: existing, error: existingError } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .select("id")
      .eq("from_id", fromId)
      .eq("to_id", toId)
      .eq("status", "pending")
      .maybeSingle();
  if (existingError) throw new Error("DB_ERROR:" + existingError.message);
  if (existing) throw new Error("ALREADY_SENT");

  const { data, error } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .insert({ from_id: fromId, to_id: toId, status: "pending" })
      .select("id")
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("DB_ERROR:missing friend request");

  void sendNotification(toId, "NEW_FRIEND_REQUEST", { fromId }).catch(() => {
    // Notification delivery is best-effort until Task 12.1 provides the real transport.
  });
  return { success: true, requestId: data.id };
}

/**
 * Accepts a pending friend request addressed to the player and creates bilateral friendship rows.
 * @param playerId - Request recipient accepting the request.
 * @param requestId - Friend request id.
 * @returns Success result containing the new friend's player id.
 * @throws REQUEST_NOT_FOUND when no matching pending request exists for playerId.
 * @throws DB_ERROR when a database operation fails.
 */
export async function acceptFriendRequest(
  playerId: string,
  requestId: string,
): Promise<AcceptResult> {
  const { data: req, error: reqError } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .select("*")
      .eq("id", requestId)
      .eq("to_id", playerId)
      .eq("status", "pending")
      .maybeSingle();
  if (reqError) throw new Error("DB_ERROR:" + reqError.message);
  if (!req) throw new Error("REQUEST_NOT_FOUND");

  const { error: updateError } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .update({ status: "accepted" })
      .eq("id", requestId);
  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  const { error: insertError } =
    await (supabaseAdmin.from("friendships") as FriendshipQuery)
      .insert([
        { player_id: playerId, friend_id: req.from_id },
        { player_id: req.from_id, friend_id: playerId },
      ]);
  if (insertError) throw new Error("DB_ERROR:" + insertError.message);

  void sendNotification(req.from_id, "FRIEND_REQUEST_ACCEPTED", {
    newFriendId: playerId,
  }).catch(() => {
    // Notification delivery is best-effort until Task 12.1 provides the real transport.
  });
  return { success: true, newFriendId: req.from_id };
}

/**
 * Declines a friend request addressed to the player.
 * @param playerId - Request recipient declining the request.
 * @param requestId - Friend request id.
 * @returns Nothing.
 * @throws REQUEST_NOT_FOUND when no matching request exists for playerId.
 * @throws DB_ERROR when a database operation fails.
 */
export async function declineFriendRequest(
  playerId: string,
  requestId: string,
): Promise<void> {
  const { data: req, error: reqError } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .select("id")
      .eq("id", requestId)
      .eq("to_id", playerId)
      .maybeSingle();
  if (reqError) throw new Error("DB_ERROR:" + reqError.message);
  if (!req) throw new Error("REQUEST_NOT_FOUND");

  const { error: updateError } =
    await (supabaseAdmin.from("friend_requests") as FriendRequestQuery)
      .update({ status: "declined" })
      .eq("id", requestId);
  if (updateError) throw new Error("DB_ERROR:" + updateError.message);
}

/**
 * Removes both directional friendship rows for two players.
 * @param playerId - Player initiating removal.
 * @param friendId - Friend being removed.
 * @returns Nothing.
 * @throws DB_ERROR when the delete operation fails.
 */
export async function removeFriend(
  playerId: string,
  friendId: string,
): Promise<void> {
  const { error } = await (supabaseAdmin.from("friendships") as FriendshipQuery)
    .delete()
    .or(
      `player_id.eq.${playerId}.and.friend_id.eq.${friendId},player_id.eq.${friendId}.and.friend_id.eq.${playerId}`,
    );
  if (error) throw new Error("DB_ERROR:" + error.message);
}

/**
 * Checks whether bilateral friendship rows exist between two players.
 * @param id1 - First player id.
 * @param id2 - Second player id.
 * @returns True when both directional friendship rows exist.
 * @throws DB_ERROR when the database query fails.
 */
export async function isMutualFriend(
  id1: string,
  id2: string,
): Promise<boolean> {
  const { count, error } =
    await (supabaseAdmin.from("friendships") as FriendshipQuery)
      .select("*", { count: "exact", head: true })
      .or(
        `and(player_id.eq.${id1},friend_id.eq.${id2}),and(player_id.eq.${id2},friend_id.eq.${id1})`,
      );
  if (error) throw new Error("DB_ERROR:" + error.message);
  return (count ?? 0) >= 2;
}

/**
 * Returns true when the target has farm pests, worn traps, or sad/neglected animals.
 * @param targetPlayerId - Player whose helper-needed state should be checked.
 * @returns True when any helpable condition is present.
 * @throws DB_ERROR when the player query fails.
 * @throws ANIMAL_NOT_FOUND:{animalType} when animal config is missing.
 */
export async function hasHelpNeeded(
  targetPlayerId: string,
): Promise<boolean> {
  const { data, error } =
    await (supabaseAdmin.from("players") as PlayerHelpQuery)
      .select("farm_plots, animals, fishing_traps")
      .eq("id", targetPlayerId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);

  const plots: FarmPlot[] = data?.farm_plots ?? [];
  if (plots.some((plot) => plot.hasBugs || plot.hasWeeds)) return true;

  const traps: FishingTrap[] = data?.fishing_traps ?? [];
  if (traps.some((trap) => trap.isWorn)) return true;

  const animals: Record<string, AnimalRecord> = data?.animals ?? {};
  const now = Math.floor(Date.now() / 1000);
  for (const animal of Object.values(animals)) {
    const config = await getAnimalConfig(animal.animalType);
    const happiness = calculateAnimalHappiness(
      animal.lastFedTimestamp,
      now,
      config.feedIntervalSeconds,
    );
    if (happiness === "SAD" || happiness === "NEGLECTED") return true;
  }

  return false;
}

/**
 * Returns public profiles for all friends plus whether each friend needs help.
 * @param playerId - Player whose friend list should be loaded.
 * @returns Friend public profiles with has_help_needed flags.
 * @throws DB_ERROR when the friendship query fails.
 * @throws PLAYER_NOT_FOUND when a friend profile is missing.
 */
export async function getFriendsList(playerId: string): Promise<FriendEntry[]> {
  const { data: rows, error } =
    await (supabaseAdmin.from("friendships") as FriendshipQuery)
      .select("friend_id")
      .eq("player_id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!rows?.length) return [];

  const friendIds = rows.map((row) => row.friend_id);
  const profiles = await Promise.all(
    friendIds.map((id) => getPlayerProfile(id)),
  );
  const helpFlags = await Promise.all(friendIds.map((id) => hasHelpNeeded(id)));
  return profiles.map((profile, index) => ({
    ...profile,
    has_help_needed: helpFlags[index],
  }));
}

/**
 * Handles HTTP requests for the friends Edge Function.
 * @param request - Incoming request with action-specific JSON fields.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "sendFriendRequest") {
      return Response.json(
        await sendFriendRequest(
          String(body.fromId ?? ""),
          String(body.toId ?? ""),
        ),
      );
    }
    if (action === "acceptFriendRequest") {
      return Response.json(
        await acceptFriendRequest(
          String(body.playerId ?? ""),
          String(body.requestId ?? ""),
        ),
      );
    }
    if (action === "declineFriendRequest") {
      await declineFriendRequest(
        String(body.playerId ?? ""),
        String(body.requestId ?? ""),
      );
      return Response.json({ success: true });
    }
    if (action === "removeFriend") {
      await removeFriend(
        String(body.playerId ?? ""),
        String(body.friendId ?? ""),
      );
      return Response.json({ success: true });
    }
    if (action === "getFriendsList") {
      return Response.json(await getFriendsList(String(body.playerId ?? "")));
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
