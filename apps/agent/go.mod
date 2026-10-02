module github.com/twinlabshq/mesh/apps/agent

go 1.27.1

require (
	github.com/stretchr/testify v1.12.1
	github.com/twinlabshq/mesh/internal v0.0.0
)

require (
	go.yaml.in/yaml/v3 v3.0.5 // indirect
	golang.org/x/crypto v0.57.0 // indirect
)

replace github.com/twinlabshq/mesh/internal => ../../internal
