module github.com/twinlabshq/mesh/apps/agent

go 1.27.1

require (
	github.com/stretchr/testify v1.12.1
	github.com/twinlabshq/mesh/internal v0.0.0
)

require (
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/crypto v0.57.0 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	golang.zx2c4.com/wintun v0.0.0-20230126152724-0fa3db229ce2 // indirect
	golang.zx2c4.com/wireguard v0.0.0-20260522210424-ecfc5a8d5446 // indirect
)

replace github.com/twinlabshq/mesh/internal => ../../internal
