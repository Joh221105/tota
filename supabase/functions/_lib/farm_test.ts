import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
} from "./farm.ts";
import type { CropConfig } from "./crops.ts";

const NOW = 1_700_000_000;
const CONSTS: PlotConstants = {
  STEAL_WINDOW_SECONDS: 60,
  OFFLINE_CAP_SECONDS: 57_600,
  WITHER_TIME_MULTIPLIER: 2.0,
  MAX_WATERINGS_PER_CYCLE: 3,
};

/**
 * Asserts equality by JSON representation.
 * @param actual - Actual value.
 * @param expected - Expected value.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when values differ.
 */
function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

/**
 * Builds a crop config fixture for pure plot state tests.
 * @param values - Optional crop config overrides.
 * @returns Crop config fixture.
 * @throws Never.
 */
function cropConfig(values: Partial<CropConfig> = {}): CropConfig {
  return {
    cropId: "crop_tomato",
    displayName: "tomato",
    growTimeSeconds: 3_600,
    regrowTimeSeconds: null,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 5,
    baseYieldMax: 8,
    seasonAvailability: "all_seasons",
    itemCategory: "crops",
    ...values,
  };
}

/**
 * Builds a farm plot fixture for pure plot state tests.
 * @param values - Optional farm plot overrides.
 * @returns Farm plot fixture.
 * @throws Never.
 */
function farmPlot(values: Partial<FarmPlot> = {}): FarmPlot {
  return {
    plotId: "plot_1",
    cropId: "crop_tomato",
    state: "PLANTED",
    plantedAt: NOW,
    regrowStartedAt: null,
    yield: 10,
    stealPool: 4,
    stealPoolRemaining: 4,
    waterings: 0,
    hasBugs: false,
    hasWeeds: false,
    fertilised: false,
    fertiliserBronzeBoost: 0,
    fertiliserSilverBoost: 0,
    isPerpetualRegrowing: false,
    needsWater: false,
    lastPestCheck: 0,
    ...values,
  };
}

Deno.test("T2.3.1 EMPTY plot", () => {
  const result = calculatePlotState(
    farmPlot({ cropId: null, state: "EMPTY" }),
    NOW,
    null,
    CONSTS,
  );

  assertEquals(result.state, "EMPTY", "state");
  assertEquals(result.canWater, false, "canWater");
  assertEquals(result.isStealable, false, "isStealable");
});

Deno.test("T2.3.2 NEEDS_WATER", () => {
  const result = calculatePlotState(
    farmPlot({ needsWater: true }),
    NOW,
    cropConfig(),
    CONSTS,
  );

  assertEquals(result.state, "NEEDS_WATER", "state");
});

Deno.test("T2.3.3 GROWING", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - 1_800 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "GROWING", "state");
  assertEquals(result.timeRemainingSeconds, 1_800, "timeRemainingSeconds");
  assertEquals(result.canWater, true, "canWater");
});

Deno.test("T2.3.4 GROWING just planted", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "GROWING", "state");
  assertEquals(result.timeRemainingSeconds, 3_600, "timeRemainingSeconds");
});

Deno.test("T2.3.5 RIPE exactly at grow time", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - 3_600 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "RIPE", "state");
  assertEquals(result.isStealable, false, "isStealable");
});

Deno.test("T2.3.6 RIPE 30s past grow", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - 3_630 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "RIPE", "state");
  assertEquals(result.isStealable, false, "isStealable");
});

Deno.test("T2.3.7 STEALABLE 61s past", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - 3_661 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "STEALABLE", "state");
  assertEquals(result.isStealable, true, "isStealable");
});

Deno.test("T2.3.8 WITHERED", () => {
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - 7_201 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "WITHERED", "state");
  assertEquals(result.yieldMultiplier, 0.5, "yieldMultiplier");
});

Deno.test("T2.3.9 Offline cap prevents WITHERED", () => {
  const growTime = 72_000;
  const result = calculatePlotState(
    farmPlot({ plantedAt: NOW - growTime - 61_200 }),
    NOW,
    cropConfig({ growTimeSeconds: growTime }),
    CONSTS,
  );

  assertEquals(result.state, "STEALABLE", "state");
  assertEquals(result.isWithered, false, "isWithered");
});

Deno.test("T2.3.10 Steal pool exhausted", () => {
  const result = calculatePlotState(
    farmPlot({ stealPoolRemaining: 0, plantedAt: NOW - 3_700 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "RIPE", "state");
  assertEquals(result.isStealable, false, "isStealable");
});

Deno.test("T2.3.11 Bug penalty", () => {
  const result = calculatePlotState(
    farmPlot({ hasBugs: true, plantedAt: NOW - 3_661 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "STEALABLE", "state");
  assertEquals(result.yieldMultiplier, 0.5, "yieldMultiplier");
});

Deno.test("T2.3.12 Withered + bugs", () => {
  const result = calculatePlotState(
    farmPlot({ hasBugs: true, plantedAt: NOW - 7_201 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "WITHERED", "state");
  assertEquals(result.yieldMultiplier, 0.25, "yieldMultiplier");
});

Deno.test("T2.3.13 Weeds extend timer", () => {
  const result = calculatePlotState(
    farmPlot({ hasWeeds: true, plantedAt: NOW - 3_500 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.effectiveGrowTime, 4_500, "effectiveGrowTime");
  assertEquals(result.state, "GROWING", "state");
});

Deno.test("T2.3.14 Max waterings", () => {
  const result = calculatePlotState(
    farmPlot({ waterings: 3, plantedAt: NOW - 1_800 }),
    NOW,
    cropConfig({ growTimeSeconds: 3_600 }),
    CONSTS,
  );

  assertEquals(result.state, "GROWING", "state");
  assertEquals(result.canWater, false, "canWater");
});

Deno.test("T2.3.15 Perpetual uses regrow time", () => {
  const result = calculatePlotState(
    farmPlot({
      isPerpetualRegrowing: true,
      regrowStartedAt: NOW - 3_000,
    }),
    NOW,
    cropConfig({
      growTimeSeconds: 14_400,
      regrowTimeSeconds: 7_200,
      isPerpetual: true,
    }),
    CONSTS,
  );

  assertEquals(result.state, "GROWING", "state");
  assertEquals(result.timeRemainingSeconds, 4_200, "timeRemainingSeconds");
});
