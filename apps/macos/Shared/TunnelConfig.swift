import Foundation

/// What the app hands the tunnel through `providerConfiguration`. The agent's
/// own state moves here once the Go agent runs inside the extension (M3.8.2).
struct TunnelConfig: Codable {
    var privateKeyHex: String
    var listenPort: Int = 51820
    /// Mesh addresses with the network prefix, e.g. "10.77.4.9/16".
    var addresses: [String]
    /// Resolver address and the domains it answers (split DNS).
    var dnsServer: String?
    var dnsDomains: [String] = []

    static let key = "config"

    func encoded() throws -> [String: Any] {
        [Self.key: try JSONEncoder().encode(self)]
    }

    static func decode(_ dict: [String: Any]?) throws -> TunnelConfig {
        guard let data = dict?[key] as? Data else { throw CocoaError(.coderValueNotFound) }
        return try JSONDecoder().decode(TunnelConfig.self, from: data)
    }
}
