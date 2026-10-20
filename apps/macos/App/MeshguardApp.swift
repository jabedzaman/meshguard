import SwiftUI

@main
struct MeshguardApp: App {
    @State private var tunnel = TunnelManager()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(tunnel)
                .task { await tunnel.load() }
                .containerBackground(.thinMaterial, for: .window)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentMinSize)

        MenuBarExtra("Meshguard", systemImage: "point.3.connected.trianglepath.dotted") {
            MenuContent().environment(tunnel)
        }
        .menuBarExtraStyle(.window)
    }
}
