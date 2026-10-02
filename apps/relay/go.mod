module github.com/jabedzaman/meshguard/apps/relay

go 1.27.1

require github.com/jabedzaman/meshguard/internal v0.0.0

require (
	github.com/coder/websocket v1.8.15 // indirect
	golang.org/x/crypto v0.57.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
)

replace github.com/jabedzaman/meshguard/internal => ../../internal
