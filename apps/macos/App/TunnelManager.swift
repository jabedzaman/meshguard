import NetworkExtension
import Observation
import os

/// Drives the packet tunnel from the app: saves the VPN configuration the
/// first time (the system asks the user to allow it) and starts and stops it.
@MainActor @Observable
final class TunnelManager {
    enum State: Equatable { case unknown, off, connecting, on, disconnecting, failed(String) }

    private(set) var state: State = .unknown
    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?
    private let installer = SystemExtensionInstaller()
    private let log = Logger(subsystem: "dev.jabed.meshguard", category: "tunnel")

    func load() async {
        do {
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            // Nothing saved yet means nothing to be connected: stay off until Connect saves one.
            manager = all.first(where: Self.isOurs)
            log.info("loaded \(all.count) configuration(s)")
            observe()
            refresh()
        } catch {
            log.error("load failed: \(error)")
            state = .failed(error.localizedDescription)
        }
    }

    /// Other VPN apps' configurations can be listed too; never touch them.
    private static func isOurs(_ m: NETunnelProviderManager) -> Bool {
        (m.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == bundleID
    }

    private static let bundleID = SystemExtensionInstaller.identifier

    func connect(_ config: TunnelConfig) async {
        do {
            state = .connecting
            try await installer.activate()
            let m = manager ?? NETunnelProviderManager()  // never one of another app's
            let proto = NETunnelProviderProtocol()
            proto.providerBundleIdentifier = Self.bundleID
            proto.serverAddress = "Meshguard"
            proto.providerConfiguration = try config.encoded()
            m.protocolConfiguration = proto
            m.localizedDescription = "Meshguard"
            m.isEnabled = true
            try await m.saveToPreferences()
            try await m.loadFromPreferences()  // required before the first start
            manager = m
            observe()
            try m.connection.startVPNTunnel()
        } catch {
            log.error("connect failed: \(error)")
            state = .failed(error.localizedDescription)
        }
    }

    func disconnect() { manager?.connection.stopVPNTunnel() }

    private func observe() {
        guard let connection = manager?.connection, observer == nil else { return }
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange, object: connection, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.refresh() } }
    }

    private func refresh() {
        let status = manager?.connection.status ?? .invalid
        log.info("status \(status.rawValue)")
        switch status {
        case .connected: state = .on
        case .connecting, .reasserting: state = .connecting
        case .disconnecting: state = .disconnecting
        default: state = .off
        }
    }
}
