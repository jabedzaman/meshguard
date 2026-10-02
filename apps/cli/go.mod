module github.com/jabedzaman/meshguard/apps/cli

go 1.27.1

require (
	github.com/spf13/cobra v1.10.2
	github.com/stretchr/testify v1.12.1
	github.com/jabedzaman/meshguard/internal v0.0.0
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/net v0.58.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
)

replace github.com/jabedzaman/meshguard/internal => ../../internal
