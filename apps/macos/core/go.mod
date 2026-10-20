module github.com/jabedzaman/meshguard/apps/macos/core

go 1.27.1

require (
	github.com/jabedzaman/meshguard/internal v0.0.0
	golang.zx2c4.com/wireguard v0.0.0-20260522210424-ecfc5a8d5446
)

require (
	github.com/coder/websocket v1.8.15 // indirect
	golang.org/x/crypto v0.57.0 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.zx2c4.com/wintun v0.0.0-20230126152724-0fa3db229ce2 // indirect
)

replace github.com/jabedzaman/meshguard/internal => ../../../internal
