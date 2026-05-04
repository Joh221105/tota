import { getConfig } from "./config.ts";

export interface AnimalProduct {
  itemId: string;
  produceTimerSeconds: number;
  yieldMin: number;
  yieldMax: number;
  dropChance: number;
}

export interface AnimalConfig {
  animalType: string;
  displayName: string;
  feedIntervalSeconds: number;
  feedCostCoins: number;
  feedItemId: string;
  products: AnimalProduct[];
  unlockLevel: number;
}

export interface AnimalRecord {
  animalId: string;
  animalType: string;
  lastFedTimestamp: number;
  lastCollectTimestamps: Record<string, number>;
}

export type AnimalHappiness = "HAPPY" | "SAD" | "NEGLECTED";

/**
 * Converts an animal config game_config value into the canonical AnimalConfig shape.
 * @param animalType - Animal catalog id without the animal_ prefix.
 * @param raw - Parsed game_config value for the animal.
 * @returns Parsed animal config with numeric fields coerced to numbers.
 * @throws Never.
 */
export function parseAnimalConfig(
  animalType: string,
  raw: unknown,
): AnimalConfig {
  const config = raw as Record<string, unknown>;
  const products = Array.isArray(config.products) ? config.products : [];

  return {
    // SPEC_AMBIGUITY: Prompt says value is a JSON-encoded AnimalConfig but sample seed JSON omits animalType and displayName.
    animalType: typeof config.animalType === "string"
      ? config.animalType
      : animalType,
    displayName: typeof config.displayName === "string"
      ? config.displayName
      : animalType.charAt(0).toUpperCase() + animalType.slice(1),
    feedIntervalSeconds: Number(config.feedIntervalSeconds),
    feedCostCoins: Number(config.feedCostCoins),
    feedItemId: String(config.feedItemId),
    products: products.map((product) => {
      const item = product as Record<string, unknown>;
      return {
        itemId: String(item.itemId),
        produceTimerSeconds: Number(item.produceTimerSeconds),
        yieldMin: Number(item.yieldMin),
        yieldMax: Number(item.yieldMax),
        dropChance: Number(item.dropChance),
      };
    }),
    unlockLevel: Number(config.unlockLevel),
  };
}

/**
 * Fetches animal config from the game_config table.
 * @param animalType - Animal catalog id without the animal_ prefix.
 * @returns Parsed animal config.
 * @throws ANIMAL_NOT_FOUND:{animalType} if not in catalog.
 */
export async function getAnimalConfig(
  animalType: string,
): Promise<AnimalConfig> {
  const raw = await getConfig("animal_" + animalType).catch(() => {
    throw new Error("ANIMAL_NOT_FOUND:" + animalType);
  });
  return parseAnimalConfig(animalType, raw);
}

/**
 * Calculates the animal happiness state from feeding age.
 * @param lastFedTimestamp - Unix seconds when the animal was last fed.
 * @param currentTimestamp - Current unix seconds.
 * @param feedIntervalSeconds - Feed interval from AnimalConfig.
 * @returns HAPPY, SAD, or NEGLECTED.
 * @throws Never.
 */
export function calculateAnimalHappiness(
  lastFedTimestamp: number,
  currentTimestamp: number,
  feedIntervalSeconds: number,
): AnimalHappiness {
  const elapsed = currentTimestamp - lastFedTimestamp;
  if (elapsed <= feedIntervalSeconds) return "HAPPY";
  if (elapsed <= feedIntervalSeconds * 2) return "SAD";
  return "NEGLECTED";
}
