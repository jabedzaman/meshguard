import SwiftUI

/// Liquid Glass shell: a floating glass sidebar over the window material,
/// and a glass status card. Real data arrives with M3.8.5.
struct RootView: View {
    @Environment(TunnelManager.self) private var tunnel
    @State private var selection: Section? = .overview

    enum Section: String, CaseIterable, Identifiable {
        case overview = "Overview", devices = "Devices", settings = "Settings"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .overview: "circle.hexagongrid"
            case .devices: "laptopcomputer.and.iphone"
            case .settings: "gearshape"
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            List(Section.allCases, selection: $selection) { s in
                Label(s.rawValue, systemImage: s.icon).tag(s)
            }
            .scrollContentBackground(.hidden)
            .navigationSplitViewColumnWidth(min: 170, ideal: 200)
        } detail: {
            switch selection ?? .overview {
            case .overview: OverviewView()
            case .devices: ContentUnavailableView("No devices yet", systemImage: "laptopcomputer.and.iphone")
            case .settings: ContentUnavailableView("Settings", systemImage: "gearshape")
            }
        }
        .frame(minWidth: 760, minHeight: 480)
    }
}

struct OverviewView: View {
    @Environment(TunnelManager.self) private var tunnel

    var body: some View {
        GlassEffectContainer(spacing: 20) {
            VStack(spacing: 20) {
                VStack(spacing: 14) {
                    Image(systemName: tunnel.state == .on ? "checkmark.shield.fill" : "shield.slash")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(tunnel.state == .on ? .green : .secondary)
                        .symbolEffect(.bounce, value: tunnel.state)
                    Text(title).font(.title2.weight(.semibold))
                    Button(tunnel.state == .on ? "Disconnect" : "Connect") { toggle() }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(tunnel.state == .connecting || tunnel.state == .disconnecting)
                }
                .padding(32)
                .frame(maxWidth: 360)
                .glassEffect(.regular, in: .rect(cornerRadius: 28))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var title: String {
        switch tunnel.state {
        case .on: "Connected"
        case .connecting: "Connecting…"
        case .disconnecting: "Disconnecting…"
        case .failed(let message): message
        default: "Not connected"
        }
    }

    private func toggle() {
        if tunnel.state == .on { tunnel.disconnect(); return }
        // Spike config; replaced by the agent's enrollment state in M3.8.2.
        Task { await tunnel.connect(.spike) }
    }
}

struct MenuContent: View {
    @Environment(TunnelManager.self) private var tunnel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(tunnel.state == .on ? "Connected" : "Not connected", systemImage: "circle.fill")
                .foregroundStyle(tunnel.state == .on ? .green : .secondary)
            Button(tunnel.state == .on ? "Disconnect" : "Connect") {
                if tunnel.state == .on { tunnel.disconnect() } else { Task { await tunnel.connect(.spike) } }
            }
            .buttonStyle(.glass)
            Divider()
            Button("Quit Meshguard") { NSApplication.shared.terminate(nil) }
        }
        .padding(14)
        .frame(width: 220)
    }
}

extension TunnelConfig {
    /// Fixed values for the first spike: a made-up key and address, so the
    /// tunnel can be seen coming up before enrollment is wired in.
    static let spike = TunnelConfig(
        privateKeyHex: String(repeating: "11", count: 32),
        addresses: ["10.77.0.2/16"]
    )
}
