import Foundation
import Supabase
import SwiftUI

struct FarmStateResponse: Decodable {
    let plots: [EnrichedPlot]
    let totalPlots: Int
    let plotsReady: Int
    let plotsGrowing: Int
    let plotsEmpty: Int
    let serverTimestamp: Int
}

struct EnrichedPlot: Decodable {
    let plotId: String
    let cropId: String?
    let state: String
    let plantedAt: Int
    let regrowStartedAt: Int?
    let yield: Int
    let stealPool: Int
    let stealPoolRemaining: Int
    let waterings: Int
    let hasBugs: Bool
    let hasWeeds: Bool
    let fertilised: Bool
    let fertiliserBronzeBoost: Int
    let fertiliserSilverBoost: Int
    let isPerpetualRegrowing: Bool
    let needsWater: Bool
    let lastPestCheck: Int
    let timeRemainingSeconds: Int
    let isStealable: Bool
    let isWithered: Bool
    let yieldMultiplier: Double
    let canWater: Bool
    let effectiveGrowTime: Int
}

@MainActor
final class FarmViewModel: ObservableObject {
    @Published var farmState: FarmStateResponse?
    @Published var isLoading = false

    private let client = SupabaseClient(
        supabaseURL: Secrets.supabaseURL,
        supabaseKey: Secrets.supabaseAnonKey
    )

    /**
     Loads farm state for the current player from the get-farm-state Edge Function.
     - Parameter playerId: Target player UUID.
     - Returns: Nothing.
     - Throws: Never.
     */
    func loadFarm(playerId: String) async {
        isLoading = true
        do {
            farmState = try await client.functions.invoke(
                "get-farm-state",
                options: .init(body: ["playerId": playerId])
            )
        } catch {
            print("Farm load error: \(error)")
        }
        isLoading = false
    }
}
