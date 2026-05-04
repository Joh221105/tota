import { getConfig, getConfigs } from "../lib/config.ts";
import { addItemToInventory } from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface FishingTrap {
  trapId: string;
  trapType: string;
  lastCollectTimestamp: number;
  isWorn: boolean;
}

export interface TrapLootEntry {
  itemId: string;
  weight: number;
}

export interface TrapConfig {
  fillSeconds: number;
  unlockLevel?: number;
  loot: TrapLootEntry[];
}

export interface TrapStateResult {
  state: "READY" | "FILLING";
  timeRemainingSeconds: number;
  isWorn: boolean;
}

export interface TrapLootCollected {
  itemId: string;
  grade: string;
  quantity: number;
}

export interface CollectTrapResult {
  success: true;
  lootCollected: TrapLootCollected;
  wasWorn: boolean;
  isNowWorn: boolean;
  xpAwarded: number;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  source: string;
}

export interface SkillXpAwardCall {
  playerId: string;
  skillTrack: string;
  amount: number;
}

interface PlayerTrapRow {
  fishing_traps?: FishingTrap[] | null;
}

interface PlayerTrapQuery {
  select(columns: string): PlayerTrapQuery;
  eq(column: string, value: string): PlayerTrapQuery;
  single(): Promise<
    { data: PlayerTrapRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerTrapQuery;
  then<
    TResult1 = {
      data: PlayerTrapRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerTrapRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const xpAwardCalls: XpAwardCall[] = [];
const skillXpAwardCalls: SkillXpAwardCall[] = [];

/**
 * Converts a trap config game_config value into the canonical TrapConfig shape.
 * @param raw - Parsed game_config value for the trap.
 * @returns Parsed trap config with numeric fields coerced to numbers.
 * @throws Never.
 */
export function parseTrapConfig(raw: unknown): TrapConfig {
  const config = raw as Record<string, unknown>;
  const loot = Array.isArray(config.loot) ? config.loot : [];
  return {
    fillSeconds: Number(config.fillSeconds),
    unlockLevel: config.unlockLevel == null
      ? undefined
      : Number(config.unlockLevel),
    loot: loot.map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        itemId: String(item.itemId),
        weight: Number(item.weight),
      };
    }),
  };
}

/**
 * Calculates whether a fishing trap is ready to collect.
 * PURE FUNCTION: this performs zero database calls and makes no persistent writes.
 * @param trap - Fishing trap state from players.fishing_traps.
 * @param currentTimestamp - Current unix seconds.
 * @param trapConfig - Trap config containing fillSeconds.
 * @returns Trap state, remaining fill time, and worn status.
 * @throws Never.
 */
export function calculateTrapState(
  trap: FishingTrap,
  currentTimestamp: number,
  trapConfig: { fillSeconds: number },
): TrapStateResult {
  const elapsed = currentTimestamp - trap.lastCollectTimestamp;
  if (elapsed >= trapConfig.fillSeconds) {
    return { state: "READY", timeRemainingSeconds: 0, isWorn: trap.isWorn };
  }
  return {
    state: "FILLING",
    timeRemainingSeconds: trapConfig.fillSeconds - elapsed,
    isWorn: trap.isWorn,
  };
}

/**
 * Rolls one item ID from a weighted loot table.
 * @param table - Loot entries with non-negative weights.
 * @returns Rolled item ID.
 * @throws EMPTY_WEIGHT_TABLE when no entries are provided.
 */
export function rollFromWeightTable(table: TrapLootEntry[]): string {
  if (table.length === 0) throw new Error("EMPTY_WEIGHT_TABLE");
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.itemId;
  }
  return table[table.length - 1].itemId;
}

/**
 * Rolls one output from a rates array.
 * @param rates - Roll rates aligned with outputs.
 * @param outputs - Output values aligned with rates.
 * @returns Rolled output.
 * @throws EMPTY_RATE_TABLE when no rates or outputs are provided.
 */
export function rollFromRatesArray<T>(rates: number[], outputs: T[]): T {
  if (rates.length === 0 || outputs.length === 0) {
    throw new Error("EMPTY_RATE_TABLE");
  }
  const totalRate = rates.reduce((sum, rate) => sum + rate, 0);
  const roll = Math.random() * totalRate;
  let cumulative = 0;
  for (
    let index = 0;
    index < rates.length && index < outputs.length;
    index += 1
  ) {
    cumulative += rates[index];
    if (roll < cumulative) return outputs[index];
  }
  return outputs[Math.min(outputs.length, rates.length) - 1];
}

/**
 * Awards XP to a player.
 * STUB: replaced by Task 10.1.
 * @param playerId - Player receiving XP.
 * @param amount - XP amount.
 * @param source - XP source.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardXP(
  playerId: string,
  amount: number,
  source: string,
): Promise<void> {
  await Promise.resolve();
  xpAwardCalls.push({ playerId, amount, source });
}

/**
 * Awards skill XP to a player.
 * STUB: replaced by Task 10.2.
 * @param playerId - Player receiving skill XP.
 * @param skillTrack - Skill track to award.
 * @param amount - XP amount.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardSkillXP(
  playerId: string,
  skillTrack: string,
  amount: number,
): Promise<void> {
  await Promise.resolve();
  skillXpAwardCalls.push({ playerId, skillTrack, amount });
}

/**
 * Resets V1 trap stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetTrapStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
}

/**
 * Returns V1 trap stub call records for tests.
 * @returns Copies of XP and skill XP calls.
 * @throws Never.
 */
export function getTrapStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
  };
}

/**
 * Collects loot from one ready fishing trap and resets its timer.
 * @param playerId - Player collecting the trap.
 * @param trapId - Trap ID in players.fishing_traps.
 * @returns Collect result with loot, worn state transition, and XP.
 * @throws TRAP_NOT_FOUND:{trapId} when the trap ID is missing from player state.
 * @throws TRAP_NOT_READY:{timeRemaining} when the trap is still filling.
 * @throws CONFIG_KEY_NOT_FOUND when a required config row is missing.
 * @throws DB_ERROR when a player query or update fails.
 */
export async function collectTrap(
  playerId: string,
  trapId: string,
): Promise<CollectTrapResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerTrapQuery)
      .select("fishing_traps")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const traps = player.fishing_traps ?? [];
  const trapIdx = traps.findIndex((trap) => trap.trapId === trapId);
  if (trapIdx === -1) throw new Error("TRAP_NOT_FOUND:" + trapId);

  const trap = traps[trapIdx];
  const trapConfig = parseTrapConfig(await getConfig("trap_" + trap.trapType));
  const now = Math.floor(Date.now() / 1000);
  const stateResult = calculateTrapState(trap, now, trapConfig);
  if (stateResult.state !== "READY") {
    throw new Error("TRAP_NOT_READY:" + stateResult.timeRemainingSeconds);
  }

  const cfg = await getConfigs([
    "TRAP_WORN_CHANCE",
    "TRAP_JUNK_CHANCE",
    "TRAP_GRADE_NORMAL",
    "TRAP_GRADE_BRONZE",
    "TRAP_GRADE_SILVER",
    "TRAP_GRADE_GOLD",
    "TRAP_GRADE_DIAMOND",
    "TRAP_WORN_NORMAL",
    "TRAP_WORN_BRONZE",
    "TRAP_WORN_SILVER",
  ]);

  let loot: { itemId: string; grade: string };
  if (Math.random() < Number(cfg["TRAP_JUNK_CHANCE"])) {
    // SPEC_AMBIGUITY: Junk items are specified as a literal list, not a game_config key.
    const junkItems = ["junk_boot", "junk_net", "junk_crate"];
    loot = {
      itemId: junkItems[Math.floor(Math.random() * junkItems.length)],
      grade: "Normal",
    };
  } else {
    const fishItemId = rollFromWeightTable(trapConfig.loot);
    const gradeRates = trap.isWorn
      ? [
        Number(cfg["TRAP_WORN_NORMAL"]),
        Number(cfg["TRAP_WORN_BRONZE"]),
        Number(cfg["TRAP_WORN_SILVER"]),
        0,
        0,
        0,
      ]
      : [
        Number(cfg["TRAP_GRADE_NORMAL"]),
        Number(cfg["TRAP_GRADE_BRONZE"]),
        Number(cfg["TRAP_GRADE_SILVER"]),
        Number(cfg["TRAP_GRADE_GOLD"]),
        Number(cfg["TRAP_GRADE_DIAMOND"]),
        0,
      ];
    const grades = [
      "Normal",
      "Bronze",
      "Silver",
      "Gold",
      "Diamond",
      "Legendary",
    ];
    loot = {
      itemId: fishItemId,
      grade: rollFromRatesArray(gradeRates, grades),
    };
  }

  const wasWorn = trap.isWorn;
  traps[trapIdx].isWorn = false;
  if (Math.random() < Number(cfg["TRAP_WORN_CHANCE"])) {
    traps[trapIdx].isWorn = true;
  }
  traps[trapIdx].lastCollectTimestamp = now;

  const { error: updateError } =
    await (supabaseAdmin.from("players") as PlayerTrapQuery)
      .update({ fishing_traps: traps })
      .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  await addItemToInventory(playerId, loot.itemId, loot.grade, 1);
  await awardXP(playerId, 15, "COLLECT_TRAP");
  await awardSkillXP(playerId, "fishing", 10);

  return {
    success: true,
    lootCollected: { ...loot, quantity: 1 },
    wasWorn,
    isNowWorn: traps[trapIdx].isWorn,
    xpAwarded: 15,
  };
}

/**
 * Handles HTTP requests for the traps Edge Function.
 * @param request - Incoming Edge Function request with playerId and trapId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await collectTrap(
      String(body.playerId ?? ""),
      String(body.trapId ?? ""),
    );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
