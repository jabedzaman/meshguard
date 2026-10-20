import Foundation
import NetworkExtension

// A system extension has no principal class; it starts the provider the
// Info.plist names under NEProviderClasses and waits.
autoreleasepool { NEProvider.startSystemExtensionMode() }
dispatchMain()
