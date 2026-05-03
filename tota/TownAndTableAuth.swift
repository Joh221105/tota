// TownAndTableAuth.swift
// Handles login on app launch. Stores session in Keychain.

import Foundation
import Security
import Supabase
import SwiftUI
import UIKit

struct LoginResult: Decodable {
    let sessionToken: String
    let playerId: String
    let isNewPlayer: Bool
    let level: Int
    let coins: Int
    let displayName: String?
}

enum KeychainHelper {
    /**
     Saves a string value in the iOS Keychain.
     - Parameter key: Keychain account key.
     - Parameter value: String value to store.
     - Returns: Nothing.
     - Throws: Never.
     */
    static func save(key: String, value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data
        ]

        SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        var insertQuery = query
        insertQuery[kSecValueData as String] = data
        SecItemAdd(insertQuery as CFDictionary, nil)
    }
}

@MainActor
final class TownAndTableAuth: ObservableObject {
    @Published var playerId: String?
    @Published var isLoading = true

    private let client = SupabaseClient(
        supabaseURL: Secrets.supabaseURL,
        supabaseKey: Secrets.supabaseAnonKey
    )

    /**
     Logs in or creates the current device account on app launch.
     - Parameter: None.
     - Returns: Nothing.
     - Throws: Never.
     */
    func loginOnLaunch() async {
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        do {
            let result: LoginResult = try await client.functions.invoke(
                "login-or-create",
                options: .init(body: ["deviceId": deviceId, "platform": "ios"])
            )
            self.playerId = result.playerId
            KeychainHelper.save(key: "sessionToken", value: result.sessionToken)
        } catch {
            print("Auth error: \(error)")
        }
        isLoading = false
    }
}
