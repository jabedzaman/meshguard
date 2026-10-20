import Darwin
import NetworkExtension
import os

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let log = Logger(subsystem: "dev.jabed.meshguard.tunnel", category: "tunnel")

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let config: TunnelConfig
        let networkSettings: NEPacketTunnelNetworkSettings
        do {
            let proto = protocolConfiguration as? NETunnelProviderProtocol
            config = try TunnelConfig.decode(proto?.providerConfiguration)
            networkSettings = try settings(for: config)
        } catch {
            completionHandler(error)
            return
        }
        // The system makes the utun when settings are applied; the Go engine
        // then runs on its descriptor.
        setTunnelNetworkSettings(networkSettings) { [self] error in
            if let error {
                completionHandler(error)
                return
            }
            completionHandler(runEngine(config))
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        MGStop()
        completionHandler()
    }

    private func runEngine(_ config: TunnelConfig) -> Error? {
        guard let fd = tunnelFileDescriptor() else {
            log.error("no utun descriptor")
            return NEVPNError(.configurationInvalid)
        }
        let body: [String: Any] = [
            "privateKey": config.privateKeyHex,
            "listenPort": config.listenPort,
            "addresses": config.addresses,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let json = String(data: data, encoding: .utf8) else {
            return NEVPNError(.configurationInvalid)
        }
        let code = json.withCString { MGStart(fd, UnsafeMutablePointer(mutating: $0)) }
        guard code == 0 else {
            log.error("MGStart failed: \(code)")
            return NEVPNError(.connectionFailed)
        }
        log.info("tunnel up on fd \(fd)")
        return nil
    }

    // MARK: Settings

    private func settings(for config: TunnelConfig) throws -> NEPacketTunnelNetworkSettings {
        // The tunnel needs a remote address; the mesh has none, so use a placeholder.
        let s = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        s.mtu = 1280

        var v4 = (addresses: [String](), masks: [String](), routes: [NEIPv4Route]())
        var v6 = (addresses: [String](), prefixes: [NSNumber](), routes: [NEIPv6Route]())
        for cidr in config.addresses {
            let parts = cidr.split(separator: "/")
            guard parts.count == 2, let bits = Int(parts[1]) else { continue }
            let ip = String(parts[0])
            if ip.contains(":") {
                v6.addresses.append(ip)
                v6.prefixes.append(128)  // the host address; the network is routed below
                v6.routes.append(NEIPv6Route(destinationAddress: network(ip, bits, v6: true), networkPrefixLength: NSNumber(value: bits)))
            } else {
                v4.addresses.append(ip)
                v4.masks.append("255.255.255.255")
                v4.routes.append(NEIPv4Route(destinationAddress: network(ip, bits, v6: false), subnetMask: mask(bits)))
            }
        }
        if !v4.addresses.isEmpty {
            let ipv4 = NEIPv4Settings(addresses: v4.addresses, subnetMasks: v4.masks)
            ipv4.includedRoutes = v4.routes
            s.ipv4Settings = ipv4
        }
        if !v6.addresses.isEmpty {
            let ipv6 = NEIPv6Settings(addresses: v6.addresses, networkPrefixLengths: v6.prefixes)
            ipv6.includedRoutes = v6.routes
            s.ipv6Settings = ipv6
        }
        if let server = config.dnsServer {
            let dns = NEDNSSettings(servers: [server])
            dns.matchDomains = config.dnsDomains  // split DNS: only the mesh's names
            dns.matchDomainsNoSearch = true
            s.dnsSettings = dns
        }
        return s
    }

    private func mask(_ bits: Int) -> String {
        let m: UInt32 = bits == 0 ? 0 : ~UInt32(0) << (32 - UInt32(bits))
        return [24, 16, 8, 0].map { String((m >> UInt32($0)) & 0xff) }.joined(separator: ".")
    }

    private func network(_ ip: String, _ bits: Int, v6: Bool) -> String {
        if v6 {
            var a = in6_addr()
            inet_pton(AF_INET6, ip, &a)
            withUnsafeMutableBytes(of: &a) { b in
                for i in 0..<16 {
                    let kept = max(0, min(8, bits - i * 8))
                    b[i] &= kept == 0 ? 0 : UInt8(truncatingIfNeeded: 0xff << (8 - kept))
                }
            }
            var buf = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            inet_ntop(AF_INET6, &a, &buf, socklen_t(buf.count))
            return String(cString: buf)
        }
        var a = in_addr()
        inet_pton(AF_INET, ip, &a)
        let m: UInt32 = bits == 0 ? 0 : ~UInt32(0) << (32 - UInt32(bits))
        a.s_addr = (UInt32(bigEndian: a.s_addr) & m).bigEndian
        var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        inet_ntop(AF_INET, &a, &buf, socklen_t(buf.count))
        return String(cString: buf)
    }

    // MARK: utun descriptor

    /// CTLIOCGINFO, _IOWR('N', 3, struct ctl_info): a macro Swift can't import.
    private let ctlIOCGINFO: UInt = 0xC064_4E03

    /// The extension isn't handed the utun's descriptor, so find the open
    /// control socket for "com.apple.net.utun_control" (as WireGuard does).
    private func tunnelFileDescriptor() -> Int32? {
        var info = ctl_info()
        withUnsafeMutablePointer(to: &info.ctl_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: MemoryLayout.size(ofValue: $0.pointee)) {
                _ = strcpy($0, "com.apple.net.utun_control")
            }
        }
        for fd: Int32 in 0...1024 {
            var addr = sockaddr_ctl()
            var len = socklen_t(MemoryLayout.size(ofValue: addr))
            let ok = withUnsafeMutablePointer(to: &addr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getpeername(fd, $0, &len) }
            }
            if ok == 0, addr.sc_family == AF_SYSTEM {
                if info.ctl_id == 0, ioctl(fd, ctlIOCGINFO, &info) != 0 { continue }
                if addr.sc_id == info.ctl_id { return fd }
            }
        }
        return nil
    }
}
