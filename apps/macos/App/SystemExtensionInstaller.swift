import Foundation
import SystemExtensions

/// Asks macOS to activate the tunnel's system extension. The first time, the
/// user approves it in System Settings → Privacy & Security; after that it is
/// a no-op, and an app update replaces the extension.
final class SystemExtensionInstaller: NSObject, OSSystemExtensionRequestDelegate, @unchecked Sendable {
    static let identifier = "dev.jabed.meshguard.tunnel"

    private var continuation: CheckedContinuation<Void, Error>?

    func activate() async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            continuation = c
            let request = OSSystemExtensionRequest.activationRequest(
                forExtensionWithIdentifier: Self.identifier, queue: .main)
            request.delegate = self
            OSSystemExtensionManager.shared.submitRequest(request)
        }
    }

    private func finish(_ result: Result<Void, Error>) {
        continuation?.resume(with: result)
        continuation = nil
    }

    // MARK: OSSystemExtensionRequestDelegate

    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        // The request stays pending until the user approves it in System Settings.
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        finish(.success(()))
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        finish(.failure(error))
    }
}
