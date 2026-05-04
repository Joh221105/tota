import { supabaseAdmin } from "./supabase.ts";

export type InventoryCategory =
  | "crops"
  | "fish"
  | "animal_produce"
  | "processed"
  | "cooked_dishes"
  | "tools";

export type InventoryGrade =
  | "Normal"
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Diamond"
  | "Legendary";

export interface AddResult {
  success: true;
  itemId: string;
  grade: string;
  quantityAdded: number;
  newStackQuantity: number;
  category: InventoryCategory;
}

export interface RemoveResult {
  success: true;
  quantityRemoved: number;
  newStackQuantity: number;
}

export interface InventoryStack {
  itemId: string;
  grade: InventoryGrade;
  quantity: number;
}

export interface InventoryRow {
  item_id: string;
  grade: InventoryGrade;
  quantity: number;
  category: InventoryCategory;
}

export interface InventoryResult {
  playerId: string;
  category: InventoryCategory | null;
  items: InventoryStack[];
}

interface InventoryExistingRow {
  id: string;
  quantity: number;
}

interface InventoryMutationRow {
  quantity: number;
}

interface PlayerSlotsRow {
  inventory_slots: Record<InventoryCategory, number>;
}

interface InventoryQuery {
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): InventoryQuery;
  eq(column: string, value: string): InventoryQuery;
  maybeSingle(): Promise<
    { data: InventoryExistingRow | null; error: { message: string } | null }
  >;
  single(): Promise<
    {
      data: InventoryMutationRow | PlayerSlotsRow | null;
      error: { message: string } | null;
    }
  >;
  update(values: Record<string, unknown>): InventoryQuery;
  insert(values: Record<string, unknown>): InventoryQuery;
  delete(): InventoryQuery;
  then<
    TResult1 = {
      data: InventoryRow[] | null;
      error: { message: string } | null;
      count?: number | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: InventoryRow[] | null;
          error: { message: string } | null;
          count?: number | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export const VALID_GRADES: InventoryGrade[] = [
  "Normal",
  "Bronze",
  "Silver",
  "Gold",
  "Diamond",
  "Legendary",
];

/**
 * Routes an item ID to its inventory category by prefix.
 * @param itemId - Item identifier to categorize.
 * @returns Inventory category for the item.
 * @throws Never.
 */
export function getCategory(itemId: string): InventoryCategory {
  if (itemId.startsWith("crop_")) return "crops";
  if (itemId.startsWith("fish_")) return "fish";
  if (itemId.startsWith("animal_")) return "animal_produce";
  if (itemId.startsWith("processed_")) return "processed";
  if (itemId.startsWith("dish_")) return "cooked_dishes";
  return "tools";
}

/**
 * Builds the standard add-item result payload.
 * @param itemId - Added item identifier.
 * @param grade - Added item grade.
 * @param quantityAdded - Quantity added by this operation.
 * @param newStackQuantity - Stack quantity after the operation.
 * @param category - Routed inventory category.
 * @returns Add-item result payload.
 * @throws Never.
 */
function buildAddResult(
  itemId: string,
  grade: string,
  quantityAdded: number,
  newStackQuantity: number,
  category: InventoryCategory,
): AddResult {
  return {
    success: true,
    itemId,
    grade,
    quantityAdded,
    newStackQuantity,
    category,
  };
}

/**
 * Adds items to inventory and respects per-category slot limits.
 * Uses the unique identity of player_id, item_id, and grade.
 * @param playerId - Target player UUID.
 * @param itemId - Item identifier to add.
 * @param grade - Item grade.
 * @param quantity - Quantity to add, from 1 through 999.
 * @returns Add result with the new stack quantity.
 * @throws INVALID_GRADE if grade is not in VALID_GRADES.
 * @throws INVALID_QUANTITY if quantity is not an integer from 1 through 999.
 * @throws DB_ERROR when an inventory or player query fails.
 * @throws INVENTORY_FULL:{category}:{used}:{max} when no new slot is available.
 * @throws STACK_OVERFLOW when the stack would exceed 999.
 */
export async function addItemToInventory(
  playerId: string,
  itemId: string,
  grade: string,
  quantity: number,
): Promise<AddResult> {
  if (!VALID_GRADES.includes(grade as InventoryGrade)) {
    throw new Error("INVALID_GRADE");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("INVALID_QUANTITY");
  }

  const category = getCategory(itemId);
  const inventory = supabaseAdmin.from("inventory") as InventoryQuery;
  const { data: existing, error: existingError } = await inventory
    .select("id, quantity")
    .eq("player_id", playerId)
    .eq("item_id", itemId)
    .eq("grade", grade)
    .maybeSingle();

  if (existingError) throw new Error("DB_ERROR:" + existingError.message);

  if (existing) {
    const newQuantity = existing.quantity + quantity;
    if (newQuantity > 999) throw new Error("STACK_OVERFLOW");

    const { data: updated, error: updateError } =
      await (supabaseAdmin.from("inventory") as InventoryQuery)
        .update({ quantity: newQuantity })
        .eq("id", existing.id)
        .select("quantity")
        .single();

    if (updateError) throw new Error("DB_ERROR:" + updateError.message);
    return buildAddResult(
      itemId,
      grade,
      quantity,
      (updated as InventoryMutationRow).quantity,
      category,
    );
  }

  const { data: slotData, error: slotError } =
    await (supabaseAdmin.from("players") as InventoryQuery)
      .select("inventory_slots")
      .eq("id", playerId)
      .single();

  if (slotError) throw new Error("DB_ERROR:" + slotError.message);
  const maxSlots = (slotData as PlayerSlotsRow).inventory_slots[category];

  const { count, error: countError } =
    await (supabaseAdmin.from("inventory") as InventoryQuery)
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("category", category);

  if (countError) throw new Error("DB_ERROR:" + countError.message);
  const usedSlots = count ?? 0;
  if (usedSlots >= maxSlots) {
    throw new Error(`INVENTORY_FULL:${category}:${usedSlots}:${maxSlots}`);
  }

  const { data: inserted, error: insertError } =
    await (supabaseAdmin.from("inventory") as InventoryQuery)
      .insert({
        player_id: playerId,
        item_id: itemId,
        grade,
        quantity,
        category,
      })
      .select("quantity")
      .single();

  if (insertError) throw new Error("DB_ERROR:" + insertError.message);
  return buildAddResult(
    itemId,
    grade,
    quantity,
    (inserted as InventoryMutationRow).quantity,
    category,
  );
}

/**
 * Removes items from inventory and deletes the row if quantity reaches zero.
 * @param playerId - Target player UUID.
 * @param itemId - Item identifier to remove.
 * @param grade - Item grade to remove.
 * @param quantity - Quantity to remove.
 * @returns Remove result with the new stack quantity.
 * @throws DB_ERROR when an inventory query fails.
 * @throws ITEM_NOT_FOUND:{itemId}:{grade} when no matching row exists.
 * @throws INSUFFICIENT_QUANTITY:{have}:{requested} when the stack is too small.
 */
export async function removeItemFromInventory(
  playerId: string,
  itemId: string,
  grade: string,
  quantity: number,
): Promise<RemoveResult> {
  const { data: row, error: rowError } =
    await (supabaseAdmin.from("inventory") as InventoryQuery)
      .select("id, quantity")
      .eq("player_id", playerId)
      .eq("item_id", itemId)
      .eq("grade", grade)
      .maybeSingle();

  if (rowError) throw new Error("DB_ERROR:" + rowError.message);
  if (!row) throw new Error(`ITEM_NOT_FOUND:${itemId}:${grade}`);
  if (row.quantity < quantity) {
    throw new Error(`INSUFFICIENT_QUANTITY:${row.quantity}:${quantity}`);
  }

  const newQuantity = row.quantity - quantity;
  if (newQuantity === 0) {
    const { error } = await (supabaseAdmin.from("inventory") as InventoryQuery)
      .delete()
      .eq("id", row.id);
    if (error) throw new Error("DB_ERROR:" + error.message);
  } else {
    const { error } = await (supabaseAdmin.from("inventory") as InventoryQuery)
      .update({ quantity: newQuantity })
      .eq("id", row.id);
    if (error) throw new Error("DB_ERROR:" + error.message);
  }

  return {
    success: true,
    quantityRemoved: quantity,
    newStackQuantity: newQuantity,
  };
}

/**
 * Returns inventory stacks for a player, optionally filtered by category.
 * // SPEC_AMBIGUITY: Task 1.6 state requires getInventory but the prompt does not define its exact return shape or error cases.
 * @param playerId - Target player UUID.
 * @param category - Optional category filter.
 * @returns Inventory result containing matching stacks.
 * @throws DB_ERROR when the inventory query fails.
 */
export async function getInventory(
  playerId: string,
  category: InventoryCategory | null = null,
): Promise<InventoryResult> {
  let query = (supabaseAdmin.from("inventory") as InventoryQuery)
    .select("item_id, grade, quantity, category")
    .eq("player_id", playerId);

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) throw new Error("DB_ERROR:" + error.message);

  return {
    playerId,
    category,
    items: (data ?? []).map((row) => ({
      itemId: row.item_id,
      grade: row.grade,
      quantity: row.quantity,
    })),
  };
}
