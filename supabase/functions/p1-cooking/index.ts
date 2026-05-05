import { getConfig } from "../_lib/config.ts";
import {
  addItemToInventory,
  type InventoryGrade,
  removeItemFromInventory,
} from "../_lib/inventory.ts";
import {
  calculateSlotState,
  type CollectPausedResult,
  type ProcessingSlot as CookingSlot,
  rollOutputGrade,
  type SlotStateResult,
  type StartJobResult,
} from "../p1-processing/index.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export type { CookingSlot, SlotStateResult, StartJobResult };

export interface CookingRecipeInput {
  itemId: string;
  qty?: number;
  quantity?: number;
}

export interface CookingRecipe {
  recipeId?: string;
  inputs: CookingRecipeInput[];
  outputItemId: string;
  outputQty?: number;
  outputQuantity?: number;
  durationSeconds: number;
  goldValue: number;
  tier: string | number;
  unlockLevel: number;
  recipeType?: "cooking";
}

export interface CookingOutputItem {
  itemId: string;
  grade: InventoryGrade;
  quantity: number;
}

export interface CookingCollectSuccessResult {
  success: true;
  outputItem: CookingOutputItem;
  slotNowEmpty: true;
}

export type CookingCollectResult =
  | CookingCollectSuccessResult
  | CollectPausedResult;

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

interface PlayerCookingRow {
  cooking_slots: CookingSlot[];
  level?: number;
}

interface InventoryQuantityRow {
  quantity: number;
}

interface CookingQuery {
  select(columns: string): CookingQuery;
  eq(column: string, value: string): CookingQuery;
  maybeSingle(): Promise<
    { data: InventoryQuantityRow | null; error: { message: string } | null }
  >;
  single(): Promise<
    { data: PlayerCookingRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): CookingQuery;
  then<
    TResult1 = {
      data: PlayerCookingRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerCookingRow[] | null;
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
 * Awards cooking skill XP to a player.
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
 * Resets V1 cooking stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetCookingStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
}

/**
 * Returns V1 cooking stub call records for tests.
 * @returns Copies of XP and skill XP calls.
 * @throws Never.
 */
export function getCookingStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
  };
}

/**
 * Starts a cooking job by validating ingredients, consuming them, and writing a RUNNING cooking slot.
 * @param playerId - Player starting the job.
 * @param slotId - Cooking slot ID, c1 through c4.
 * @param recipeId - Config key for the cooking recipe.
 * @param inputGrades - Grade selection keyed by input item ID.
 * @returns Started slot and estimated completion timestamp.
 * @throws SLOT_NOT_UNLOCKED:c3 when c3 is used below level 25.
 * @throws SLOT_NOT_UNLOCKED:c4 when c4 is used below level 40.
 * @throws SLOT_NOT_FOUND:{slotId} when the slot is absent.
 * @throws SLOT_OCCUPIED:{slotId} when the slot is not EMPTY.
 * @throws RECIPE_NOT_FOUND:{recipeId} when recipe config is missing.
 * @throws RECIPE_NOT_UNLOCKED when the player level is below the recipe unlock level.
 * @throws INSUFFICIENT_INGREDIENTS:{recipeId}:{itemId} when an input is missing or short.
 * @throws DB_ERROR when player or inventory reads and writes fail.
 */
export async function startCookingJob(
  playerId: string,
  slotId: string,
  recipeId: string,
  inputGrades: Record<string, string>,
): Promise<StartJobResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as CookingQuery)
      .select("cooking_slots, level")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");
  if (slotId === "c3" && (player.level ?? 0) < 25) {
    throw new Error("SLOT_NOT_UNLOCKED:c3");
  }
  if (slotId === "c4" && (player.level ?? 0) < 40) {
    throw new Error("SLOT_NOT_UNLOCKED:c4");
  }

  const slots = player.cooking_slots;
  const slotIdx = slots.findIndex((slot) => slot.slotId === slotId);
  if (slotIdx === -1) throw new Error("SLOT_NOT_FOUND:" + slotId);
  if (slots[slotIdx].state !== "EMPTY") {
    throw new Error("SLOT_OCCUPIED:" + slotId);
  }

  const recipe = await getCookingRecipe(recipeId);
  if ((player.level ?? 0) < recipe.unlockLevel) {
    throw new Error("RECIPE_NOT_UNLOCKED");
  }

  for (const input of recipe.inputs) {
    await validateInputAvailable(playerId, recipeId, input, inputGrades);
  }

  const flatInputGrades: string[] = [];
  for (const input of recipe.inputs) {
    const grade = inputGrades[input.itemId] ?? "Normal";
    const quantity = getInputQuantity(input);
    await removeItemFromInventory(playerId, input.itemId, grade, quantity);
    flatInputGrades.push(...Array(quantity).fill(grade));
  }

  const now = Math.floor(Date.now() / 1000);
  slots[slotIdx] = {
    slotId,
    recipeId,
    state: "RUNNING",
    startedAt: now,
    inputGrades: flatInputGrades,
  };

  const { error: updateError } =
    await (supabaseAdmin.from("players") as CookingQuery)
      .update({ cooking_slots: slots })
      .eq("id", playerId);
  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  const xp = await getCookingXp(recipe);
  await awardXP(playerId, xp, "START_COOKING_JOB");
  await awardSkillXP(playerId, "cooking", xp);

  return {
    success: true,
    slot: slots[slotIdx],
    estimatedCompletionAt: now + recipe.durationSeconds,
  };
}

/**
 * Collects a complete cooking output, adds it through inventory helpers, and clears the slot.
 * // SPEC_AMBIGUITY: The Task 4.2 prompt inherits Task 4.1 PAUSED behavior; this implementation treats PAUSED as a retryable collectible state.
 * @param playerId - Player collecting the cooked dish.
 * @param slotId - Cooking slot identifier.
 * @returns Collection result or PAUSED result when cooked_dishes inventory is full.
 * @throws SLOT_NOT_FOUND:{slotId} when the slot is absent.
 * @throws JOB_NOT_COMPLETE:{state} when the slot is not complete or paused.
 * @throws RECIPE_NOT_FOUND:{recipeId} when recipe config is missing.
 * @throws DB_ERROR when player reads or writes fail.
 */
export async function collectCookingOutput(
  playerId: string,
  slotId: string,
): Promise<CookingCollectResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as CookingQuery)
      .select("cooking_slots")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const slots = player.cooking_slots;
  const slotIdx = slots.findIndex((slot) => slot.slotId === slotId);
  if (slotIdx === -1) throw new Error("SLOT_NOT_FOUND:" + slotId);

  const slot = slots[slotIdx];
  const recipe = await getCookingRecipe(slot.recipeId ?? "");
  const stateResult = calculateSlotState(
    slot,
    Math.floor(Date.now() / 1000),
    recipe,
  );
  if (stateResult.state !== "COMPLETE" && slot.state !== "PAUSED") {
    throw new Error("JOB_NOT_COMPLETE:" + stateResult.state);
  }

  const outputGrade = rollOutputGrade(slot.inputGrades);
  const outputQuantity = getRecipeOutputQuantity(recipe);
  try {
    await addItemToInventory(
      playerId,
      recipe.outputItemId,
      outputGrade,
      outputQuantity,
    );
  } catch (error) {
    if (String(error).includes("INVENTORY_FULL")) {
      slots[slotIdx].state = "PAUSED";
      const { error: updateError } =
        await (supabaseAdmin.from("players") as CookingQuery)
          .update({ cooking_slots: slots })
          .eq("id", playerId);
      if (updateError) throw new Error("DB_ERROR:" + updateError.message);
      return { success: false, state: "PAUSED", reason: "INVENTORY_FULL" };
    }
    throw error;
  }

  await clearSlot(playerId, slots, slotIdx, slotId);
  return {
    success: true,
    outputItem: {
      itemId: recipe.outputItemId,
      grade: outputGrade,
      quantity: outputQuantity,
    },
    slotNowEmpty: true,
  };
}

/**
 * Handles HTTP requests for the cooking Edge Function.
 * @param request - Incoming Edge Function request with action-specific JSON.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");
    const playerId = String(body.playerId ?? "");
    const slotId = String(body.slotId ?? "");
    const result = action === "start"
      ? await startCookingJob(
        playerId,
        slotId,
        String(body.recipeId ?? ""),
        (body.inputGrades ?? {}) as Record<string, string>,
      )
      : await collectCookingOutput(playerId, slotId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Fetches and normalizes a cooking recipe config.
 * // SPEC_AMBIGUITY: Task 4.2 names a cooking side recipe recipe_fries, but Task 4.1 already uses recipe_fries for processing fries; this implementation uses recipe_fries_dish for the cooked side dish config key.
 * // SPEC_AMBIGUITY: Cooking recipe inputs are listed as shorthand names such as bun and beef; seed config uses concrete V1 inventory item IDs such as processed_bun and animal_beef.
 * @param recipeId - Config key.
 * @returns Cooking recipe with recipeId attached.
 * @throws RECIPE_NOT_FOUND:{recipeId} when config is missing.
 */
async function getCookingRecipe(recipeId: string): Promise<CookingRecipe> {
  try {
    const recipe = await getConfig(recipeId) as CookingRecipe;
    return { ...recipe, recipeId };
  } catch (error) {
    if (String(error).includes("CONFIG_KEY_NOT_FOUND")) {
      throw new Error("RECIPE_NOT_FOUND:" + recipeId);
    }
    throw error;
  }
}

/**
 * Validates one recipe input without mutating inventory.
 * @param playerId - Player ID.
 * @param recipeId - Recipe ID for exact error strings.
 * @param input - Recipe input.
 * @param inputGrades - Grade selections by item ID.
 * @returns Nothing.
 * @throws INSUFFICIENT_INGREDIENTS:{recipeId}:{itemId} when input is short.
 */
async function validateInputAvailable(
  playerId: string,
  recipeId: string,
  input: CookingRecipeInput,
  inputGrades: Record<string, string>,
): Promise<void> {
  const grade = inputGrades[input.itemId] ?? "Normal";
  const { data: inv, error } =
    await (supabaseAdmin.from("inventory") as CookingQuery)
      .select("quantity")
      .eq("player_id", playerId)
      .eq("item_id", input.itemId)
      .eq("grade", grade)
      .maybeSingle();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!inv || inv.quantity < getInputQuantity(input)) {
    throw new Error(
      "INSUFFICIENT_INGREDIENTS:" + recipeId + ":" + input.itemId,
    );
  }
}

/**
 * Returns configured cooking XP for the recipe tier.
 * @param recipe - Cooking recipe.
 * @returns XP for recipe tier.
 * @throws CONFIG_KEY_NOT_FOUND when COOKING_XP_BY_TIER is missing.
 */
async function getCookingXp(recipe: CookingRecipe): Promise<number> {
  const xpByTier = await getConfig("COOKING_XP_BY_TIER") as Record<
    string,
    number
  >;
  return Number(xpByTier[String(recipe.tier)]);
}

/**
 * Returns an input quantity while tolerating both spec aliases.
 * @param input - Recipe input.
 * @returns Input quantity.
 * @throws Never.
 */
function getInputQuantity(input: CookingRecipeInput): number {
  return Number(input.qty ?? input.quantity ?? 0);
}

/**
 * Returns an output quantity while tolerating both spec aliases.
 * // SPEC_AMBIGUITY: Task 4.2 says cooking recipes use the same structure as processing recipes, where examples use outputQty but pseudocode used outputQuantity.
 * @param recipe - Cooking recipe.
 * @returns Output quantity.
 * @throws Never.
 */
function getRecipeOutputQuantity(recipe: CookingRecipe): number {
  return Number(recipe.outputQuantity ?? recipe.outputQty ?? 1);
}

/**
 * Clears one cooking slot and persists the player slots array.
 * @param playerId - Player ID.
 * @param slots - Slots array to mutate and write.
 * @param slotIdx - Slot index to clear.
 * @param slotId - Slot ID.
 * @returns Nothing.
 * @throws DB_ERROR when slot write fails.
 */
async function clearSlot(
  playerId: string,
  slots: CookingSlot[],
  slotIdx: number,
  slotId: string,
): Promise<void> {
  slots[slotIdx] = {
    slotId,
    recipeId: null,
    state: "EMPTY",
    startedAt: null,
    inputGrades: [],
  };
  const { error } = await (supabaseAdmin.from("players") as CookingQuery)
    .update({ cooking_slots: slots })
    .eq("id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
