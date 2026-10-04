# syntax=docker/dockerfile:1.7
# Production image. Build context is the repo root:
#   docker build -f apps/relay/Dockerfile .
FROM golang:1.27 AS build
WORKDIR /src
# Module downloads are their own layer, rebuilt only when go.mod/go.sum change.
COPY internal/go.mod internal/go.sum internal/
COPY apps/relay/go.mod apps/relay/go.sum apps/relay/
ENV GOWORK=off CGO_ENABLED=0
RUN --mount=type=cache,id=gomod,target=/go/pkg/mod cd apps/relay && go mod download
COPY internal internal
COPY apps/relay apps/relay
RUN --mount=type=cache,id=gomod,target=/go/pkg/mod \
    --mount=type=cache,id=gobuild,target=/root/.cache/go-build \
    cd apps/relay && go build -trimpath -ldflags "-s -w" -o /out/meshguard-relay ./cmd/meshguard-relay

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/meshguard-relay /meshguard-relay
# Relay (WebSocket) and STUN (UDP; disable with -stun-addr=).
EXPOSE 3340 3478/udp 3479/udp
ENTRYPOINT ["/meshguard-relay"]
