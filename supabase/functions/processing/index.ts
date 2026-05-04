import { getConfig } from "../lib/config.ts";
import { creditCoins } from "../lib/economy.ts";
import {
  addItemToInventory,
  type InventoryGrade,
  removeItemFromInventory,
} from "../lib/inventory.ts";
import { CROP_IDS } from "../lib/crops.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export type ProcessingSlotState = "EMPTY" | "RUNNING" | "COMPLETE" | "PAUSED";

export interface ProcessingSlot {
  slotId: string;
  recipeId: string | null;
  state: ProcessingSlotState;
  startedAt: number | null;
  inputGrades: string[];
}

export interface ProcessingRecipeInput {
  itemId: string;
  qty?: number;
  quantity?: number;
}

export interface ProcessingRecipe {
  recipeId?: string;
  inputs: ProcessingRecipeInput[];
  outputItemId: string;
  outputQty?: number;
  outputQuantity?: number;
  durationSeconds: number;
  unlockLevel: number;
  recipeType: "processing" | "recycler";
}

export interface StartJobResult {
  success: true;
  slot: ProcessingSlot;
  estimatedCompletionAt: number;
}

export interface SlotStateResult {
  state: ProcessingSlotState;
  timeRemaining: number;
}

export interface OutputItem {
  itemId: string;
  grade: InventoryGrade;
  quantity: number;
}

export interface CoinLoot {
  type: "coins";
  amount: number;
}

export interface CollectSuccessResult {
  success: true;
  outputItem: OutputItem | CoinLoot;
  slotNowEmpty: true;
}

export interface CollectPausedResult {
  success: false;
  state: "PAUSED";
  reason: "INVENTORY_FULL";
}

export type CollectResult = CollectSuccessResult | CollectPausedResult;

export interface CrateLootEntry {
  type: "coins" | "item";
  amount?: number;
  itemId?: string;
  qty?: number;
  quantity?: number;
  weight: number;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  source: string;
}

interface PlayerProcessingRow {
  processing_slots: ProcessingSlot[];
  level?: number;
}

interface InventoryQuantityRow {
  item_id?: string;
  grade?: string;
  quantity: number;
}

interface ProcessingQuery {
  select(columns: string): ProcessingQuery;
  eq(column: string, value: string): ProcessingQuery;
  maybeSingle(): Promise<
    { data: InventoryQuantityRow | null; error: { message: string } | null }
  >;
  single(): Promise<
    { data: PlayerProcessingRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): ProcessingQuery;
  then<
    TResult1 = {
      data: InventoryQuantityRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: InventoryQuantityRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const GRADE_WEIGHTS: Record<InventoryGrade, number> = {
  Normal: 1,
  Bronze: 2,
  Silver: 3,
  Gold: 4,
  Diamond: 5,
  Legendary: 6,
};
const OUTPUT_GRADES = Object.keys(GRADE_WEIGHTS) as InventoryGrade[];
const GRADE_PROBABILITY_TABLE: Record<
  number,
  Partial<Record<InventoryGrade, number>>
> = {
  1: { Normal: 0.80, Bronze: 0.18, Silver: 0.02 },
  2: { Normal: 0.40, Bronze: 0.45, Silver: 0.13, Gold: 0.02 },
  3: { Normal: 0.10, Bronze: 0.30, Silver: 0.45, Gold: 0.13, Diamond: 0.02 },
  4: {
    Normal: 0.02,
    Bronze: 0.05,
    Silver: 0.20,
    Gold: 0.55,
    Diamond: 0.17,
    Legendary: 0.01,
  },
  5: {
    Normal: 0,
    Bronze: 0.02,
    Silver: 0.08,
    Gold: 0.20,
    Diamond: 0.65,
    Legendary: 0.05,
  },
};
const xpAwardCalls: XpAwardCall[] = [];

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
 * Resets V1 processing stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetProcessingStubsForTesting(): void {
  xpAwardCalls.length = 0;
}

/**
 * Returns V1 processing stub call records for tests.
 * @returns Copies of XP award calls.
 * @throws Never.
 */
export function getProcessingStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
} {
  return { xpAwards: [...xpAwardCalls] };
}

/**
 * Starts a processing job by validating ingredients, consuming them, and writing a RUNNING slot.
 * @param playerId - Player starting the job.
 * @param slotId - Processing slot identifier.
 * @param recipeId - Config key for the processing recipe.
 * @param inputGrades - Grade selection keyed by input item ID.
 * @returns Started slot and estimated completion timestamp.
 * @throws SLOT_NOT_FOUND:{slotId} when the slot is absent.
 * @throws SLOT_OCCUPIED:{slotId} when the slot is not EMPTY.
 * @throws RECIPE_NOT_FOUND:{recipeId} when recipe config is missing.
 * @throws RECIPE_NOT_UNLOCKED when the player level is below the recipe unlock level.
 * @throws INSUFFICIENT_INGREDIENTS:{recipeId}:{itemId} when an input is missing or short.
 * @throws DB_ERROR when player or inventory reads and writes fail.
 */
export async function startProcessingJob(
  playerId: string,
  slotId: string,
  recipeId: string,
  inputGrades: Record<string, string>,
): Promise<StartJobResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as ProcessingQuery)
      .select("processing_slots, level")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const slots = player.processing_slots;
  const slotIdx = slots.findIndex((slot) => slot.slotId === slotId);
  if (slotIdx === -1) throw new Error("SLOT_NOT_FOUND:" + slotId);
  if (slots[slotIdx].state !== "EMPTY") {
    throw new Error("SLOT_OCCUPIED:" + slotId);
  }

  const recipe = await getProcessingRecipe(recipeId);
  if ((player.level ?? 0) < recipe.unlockLevel) {
    throw new Error("RECIPE_NOT_UNLOCKED");
  }

  for (const input of recipe.inputs) {
    await validateInputAvailable(playerId, recipeId, input, inputGrades);
  }

  const flatInputGrades: string[] = [];
  for (const input of recipe.inputs) {
    const consumedGrades = await removeInput(
      playerId,
      recipeId,
      input,
      inputGrades,
    );
    flatInputGrades.push(...consumedGrades);
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
    await (supabaseAdmin.from("players") as ProcessingQuery)
      .update({ processing_slots: slots })
      .eq("id", playerId);
  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  await awardXP(playerId, 20, "START_PROCESSING_JOB");
  return {
    success: true,
    slot: slots[slotIdx],
    estimatedCompletionAt: now + recipe.durationSeconds,
  };
}

/**
 * Calculates the current state of one processing slot without reading or writing external state.
 * @param slot - Processing slot to evaluate.
 * @param currentTimestamp - Current unix timestamp in seconds.
 * @param recipe - Recipe timing data.
 * @returns Derived slot state and remaining time.
 * @throws Never.
 */
export function calculateSlotState(
  slot: ProcessingSlot,
  currentTimestamp: number,
  recipe: { durationSeconds: number },
): SlotStateResult {
  if (slot.state === "EMPTY") return { state: "EMPTY", timeRemaining: 0 };
  if (slot.state === "PAUSED") return { state: "PAUSED", timeRemaining: 0 };
  if (slot.state === "COMPLETE") return { state: "COMPLETE", timeRemaining: 0 };

  const elapsed = currentTimestamp - (slot.startedAt ?? 0);
  if (elapsed < recipe.durationSeconds) {
    return {
      state: "RUNNING",
      timeRemaining: recipe.durationSeconds - elapsed,
    };
  }
  return { state: "COMPLETE", timeRemaining: 0 };
}

/**
 * Collects a complete processing output, adds it through inventory helpers, and clears the slot.
 * // SPEC_AMBIGUITY: The spec says PAUSED resumes, but calculateSlotState explicitly returns PAUSED for PAUSED slots. This implementation treats PAUSED as collectible retry state.
 * @param playerId - Player collecting the output.
 * @param slotId - Processing slot identifier.
 * @returns Collection result or PAUSED result when inventory is full.
 * @throws SLOT_NOT_FOUND:{slotId} when the slot is absent.
 * @throws JOB_NOT_COMPLETE:{state} when the slot is not complete or paused.
 * @throws RECIPE_NOT_FOUND:{recipeId} when recipe config is missing.
 * @throws DB_ERROR when player reads or writes fail.
 */
export async function collectProcessingOutput(
  playerId: string,
  slotId: string,
): Promise<CollectResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as ProcessingQuery)
      .select("processing_slots")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const slots = player.processing_slots;
  const slotIdx = slots.findIndex((slot) => slot.slotId === slotId);
  if (slotIdx === -1) throw new Error("SLOT_NOT_FOUND:" + slotId);

  const slot = slots[slotIdx];
  const recipe = await getProcessingRecipe(slot.recipeId ?? "");
  const stateResult = calculateSlotState(
    slot,
    Math.floor(Date.now() / 1000),
    recipe,
  );
  if (stateResult.state !== "COMPLETE" && slot.state !== "PAUSED") {
    throw new Error("JOB_NOT_COMPLETE:" + stateResult.state);
  }

  if (
    recipe.recipeType === "recycler" &&
    recipe.recipeId === "recipe_recycle_crate"
  ) {
    const loot = await rollCrateLoot(playerId);
    await clearSlot(playerId, slots, slotIdx, slotId);
    return { success: true, outputItem: loot, slotNowEmpty: true };
  }

  const outputGrade = recipe.outputItemId === "random_bronze_crop"
    ? "Bronze"
    : rollOutputGrade(slot.inputGrades);
  const outputItem = resolveOutputItem(recipe.outputItemId);
  const outputQuantity = getRecipeOutputQuantity(recipe);

  try {
    await addItemToInventory(
      playerId,
      outputItem.itemId,
      outputGrade,
      outputQuantity,
    );
  } catch (error) {
    if (String(error).includes("INVENTORY_FULL")) {
      slots[slotIdx].state = "PAUSED";
      const { error: updateError } =
        await (supabaseAdmin.from("players") as ProcessingQuery)
          .update({ processing_slots: slots })
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
      itemId: outputItem.itemId,
      grade: outputGrade,
      quantity: outputQuantity,
    },
    slotNowEmpty: true,
  };
}

/**
 * Rolls an output grade from flat input grades using the weighted-average probability table.
 * // SPEC_AMBIGUITY: The table stops at weight 5 although Legendary has weight 6; this implementation clamps averages above 5 to the weight-5 row.
 * @param inputGrades - One grade entry per consumed input unit.
 * @returns Rolled output grade.
 * @throws INVALID_GRADE when any input grade is unknown.
 */
export function rollOutputGrade(inputGrades: string[]): InventoryGrade {
  if (inputGrades.length === 0) return "Normal";
  const weights = inputGrades.map((grade) => {
    if (!(grade in GRADE_WEIGHTS)) throw new Error("INVALID_GRADE");
    return GRADE_WEIGHTS[grade as InventoryGrade];
  });
  const average = Math.min(
    5,
    Math.max(
      1,
      weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
    ),
  );
  const lower = Math.floor(average);
  const upper = Math.ceil(average);
  const fraction = average - lower;
  const probabilities = interpolateProbabilities(lower, upper, fraction);
  return rollGradeFromProbabilities(probabilities);
}

/**
 * Rolls crate recycler loot from CRATE_RANDOM_LOOT and applies it through economy or inventory helpers.
 * // SPEC_AMBIGUITY: random_normal_crop is a placeholder, not a concrete item ID; this implementation rolls uniformly from the V1 crop catalog.
 * @param playerId - Player receiving crate loot.
 * @returns Awarded loot payload.
 * @throws CONFIG_KEY_NOT_FOUND when CRATE_RANDOM_LOOT is missing.
 * @throws EMPTY_WEIGHT_TABLE when the configured loot table is empty.
 */
export async function rollCrateLoot(
  playerId: string,
): Promise<OutputItem | CoinLoot> {
  const table = await getConfig("CRATE_RANDOM_LOOT") as CrateLootEntry[];
  const entry = rollFromCrateTable(table);
  if (entry.type === "coins") {
    const amount = Number(entry.amount ?? 0);
    await creditCoins(
      playerId,
      amount,
      "EVENT_REWARD",
      `crate:${playerId}:${crypto.randomUUID()}`,
      { source: "recipe_recycle_crate" },
    );
    return { type: "coins", amount };
  }

  const item = resolveOutputItem(String(entry.itemId));
  const quantity = Number(entry.qty ?? entry.quantity ?? 1);
  await addItemToInventory(playerId, item.itemId, item.grade, quantity);
  return { itemId: item.itemId, grade: item.grade, quantity };
}

/**
 * Handles HTTP requests for the processing Edge Function.
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
      ? await startProcessingJob(
        playerId,
        slotId,
        String(body.recipeId ?? ""),
        (body.inputGrades ?? {}) as Record<string, string>,
      )
      : await collectProcessingOutput(playerId, slotId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Fetches and normalizes a processing recipe config.
 * @param recipeId - Config key.
 * @returns Processing recipe with recipeId attached.
 * @throws RECIPE_NOT_FOUND:{recipeId} when config is missing.
 */
async function getProcessingRecipe(
  recipeId: string,
): Promise<ProcessingRecipe> {
  try {
    const recipe = await getConfig(recipeId) as ProcessingRecipe;
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
 * // SPEC_AMBIGUITY: recipe_recycle_mixed uses any_junk as an input item, but inventory stores concrete item IDs. This implementation accepts any junk_* stacks, prioritizing inputGrades.any_junk when present.
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
  input: ProcessingRecipeInput,
  inputGrades: Record<string, string>,
): Promise<void> {
  if (input.itemId === "any_junk") {
    const stacks = await getJunkStacks(playerId, inputGrades.any_junk);
    const total = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
    if (total < getInputQuantity(input)) {
      throw new Error("INSUFFICIENT_INGREDIENTS:" + recipeId + ":any_junk");
    }
    return;
  }

  const grade = inputGrades[input.itemId] ?? "Normal";
  const { data: inv, error } =
    await (supabaseAdmin.from("inventory") as ProcessingQuery)
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
 * Removes one recipe input and returns one grade entry per consumed unit.
 * @param playerId - Player ID.
 * @param recipeId - Recipe ID for exact error strings.
 * @param input - Recipe input.
 * @param inputGrades - Grade selections by item ID.
 * @returns Flat consumed grade list.
 * @throws Any inventory helper error.
 */
async function removeInput(
  playerId: string,
  recipeId: string,
  input: ProcessingRecipeInput,
  inputGrades: Record<string, string>,
): Promise<string[]> {
  const quantity = getInputQuantity(input);
  if (input.itemId === "any_junk") {
    const stacks = await getJunkStacks(playerId, inputGrades.any_junk);
    let remaining = quantity;
    const removedGrades: string[] = [];
    for (const stack of stacks) {
      if (remaining === 0) break;
      const removeQuantity = Math.min(remaining, stack.quantity);
      await removeItemFromInventory(
        playerId,
        String(stack.item_id),
        String(stack.grade),
        removeQuantity,
      );
      removedGrades.push(...Array(removeQuantity).fill(String(stack.grade)));
      remaining -= removeQuantity;
    }
    if (remaining > 0) {
      throw new Error("INSUFFICIENT_INGREDIENTS:" + recipeId + ":any_junk");
    }
    return removedGrades;
  }

  const grade = inputGrades[input.itemId] ?? "Normal";
  await removeItemFromInventory(playerId, input.itemId, grade, quantity);
  return Array(quantity).fill(grade);
}

/**
 * Fetches usable junk stacks for the mixed recycler recipe.
 * @param playerId - Player ID.
 * @param gradeFilter - Optional grade filter.
 * @returns Concrete junk inventory stacks.
 * @throws DB_ERROR when inventory read fails.
 */
async function getJunkStacks(
  playerId: string,
  gradeFilter?: string,
): Promise<InventoryQuantityRow[]> {
  const { data, error } =
    await (supabaseAdmin.from("inventory") as ProcessingQuery)
      .select("item_id, grade, quantity")
      .eq("player_id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
  return (data ?? [])
    .filter((stack) => String(stack.item_id).startsWith("junk_"))
    .filter((stack) => !gradeFilter || stack.grade === gradeFilter)
    .sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)));
}

/**
 * Returns an input quantity while tolerating both spec aliases.
 * @param input - Recipe input.
 * @returns Input quantity.
 * @throws Never.
 */
function getInputQuantity(input: ProcessingRecipeInput): number {
  return Number(input.qty ?? input.quantity ?? 0);
}

/**
 * Returns an output quantity while tolerating both spec aliases.
 * // SPEC_AMBIGUITY: Recipe examples use outputQty, but pseudocode reads recipe.outputQuantity.
 * @param recipe - Processing recipe.
 * @returns Output quantity.
 * @throws Never.
 */
function getRecipeOutputQuantity(recipe: ProcessingRecipe): number {
  return Number(recipe.outputQuantity ?? recipe.outputQty ?? 0);
}

/**
 * Converts placeholder output item IDs into concrete item and grade defaults.
 * @param itemId - Configured output item ID.
 * @returns Concrete item ID and default grade.
 * @throws Never.
 */
function resolveOutputItem(
  itemId: string,
): { itemId: string; grade: InventoryGrade } {
  if (itemId === "random_normal_crop") {
    return { itemId: rollCropId(), grade: "Normal" };
  }
  if (itemId === "random_bronze_crop") {
    return { itemId: rollCropId(), grade: "Bronze" };
  }
  return { itemId, grade: "Normal" };
}

/**
 * Rolls uniformly from the V1 crop catalog.
 * @returns Crop item ID.
 * @throws Never.
 */
function rollCropId(): string {
  return CROP_IDS[Math.floor(Math.random() * CROP_IDS.length)];
}

/**
 * Rolls a configured crate table entry.
 * @param table - Weighted crate loot entries.
 * @returns Rolled entry.
 * @throws EMPTY_WEIGHT_TABLE when table is empty.
 */
function rollFromCrateTable(table: CrateLootEntry[]): CrateLootEntry {
  if (table.length === 0) throw new Error("EMPTY_WEIGHT_TABLE");
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry;
  }
  return table[table.length - 1];
}

/**
 * Interpolates grade probabilities between two integer table rows.
 * @param lower - Lower table key.
 * @param upper - Upper table key.
 * @param fraction - Interpolation fraction.
 * @returns Interpolated probability map.
 * @throws Never.
 */
function interpolateProbabilities(
  lower: number,
  upper: number,
  fraction: number,
): Record<InventoryGrade, number> {
  const lowerRow = GRADE_PROBABILITY_TABLE[lower];
  const upperRow = GRADE_PROBABILITY_TABLE[upper];
  return Object.fromEntries(OUTPUT_GRADES.map((grade) => [
    grade,
    (lowerRow[grade] ?? 0) +
    ((upperRow[grade] ?? 0) - (lowerRow[grade] ?? 0)) * fraction,
  ])) as Record<InventoryGrade, number>;
}

/**
 * Rolls a grade from a probability map.
 * @param probabilities - Probability map keyed by grade.
 * @returns Rolled grade.
 * @throws Never.
 */
function rollGradeFromProbabilities(
  probabilities: Record<InventoryGrade, number>,
): InventoryGrade {
  const total = OUTPUT_GRADES.reduce(
    (sum, grade) => sum + probabilities[grade],
    0,
  );
  const roll = Math.random() * total;
  let cumulative = 0;
  for (const grade of OUTPUT_GRADES) {
    cumulative += probabilities[grade];
    if (roll < cumulative) return grade;
  }
  return "Legendary";
}

/**
 * Clears one processing slot and persists the player slots array.
 * @param playerId - Player ID.
 * @param slots - Slots array to mutate and write.
 * @param slotIdx - Slot index to clear.
 * @param slotId - Slot ID.
 * @returns Nothing.
 * @throws DB_ERROR when slot write fails.
 */
async function clearSlot(
  playerId: string,
  slots: ProcessingSlot[],
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
  const { error } = await (supabaseAdmin.from("players") as ProcessingQuery)
    .update({ processing_slots: slots })
    .eq("id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
