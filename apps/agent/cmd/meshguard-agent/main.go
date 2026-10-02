// Command meshguard-agent is the device daemon. It owns the device's keys and
// WireGuard interface and serves a local API to the desktop app and CLI.
//
//	meshguard-agent [flags]               run in the foreground
//	sudo meshguard-agent install [flags]  install as a system service and start it
//	sudo meshguard-agent uninstall        stop and remove the service
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"

	"github.com/jabedzaman/meshguard/apps/agent/internal/agent"
	"github.com/jabedzaman/meshguard/apps/agent/internal/service"
	"github.com/jabedzaman/meshguard/internal/ipc"
	"github.com/jabedzaman/meshguard/internal/state"
)

var version = "dev"

type options struct {
	socket      string
	socketOwner string
	stateDir    string
	port        int
	iface       string
}

func flags(name string) (*flag.FlagSet, *options) {
	o := &options{}
	fs := flag.NewFlagSet(name, flag.ExitOnError)
	fs.StringVar(&o.socket, "socket", ipc.DefaultSocketPath(), "local API socket path")
	fs.StringVar(&o.socketOwner, "socket-owner", "", `"uid:gid" that owns the socket so that user can run meshguard without sudo (default: the sudo user)`)
	fs.StringVar(&o.stateDir, "state-dir", state.DefaultDir(), "directory for keys and enrollment state")
	fs.IntVar(&o.port, "port", 51820, "WireGuard UDP listen port")
	fs.StringVar(&o.iface, "interface", "", `WireGuard interface name (default "meshguard0"; "utun" on macOS)`)
	return fs, o
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			exitOn(installService(os.Args[2:]))
			return
		case "uninstall":
			exitOn(service.Uninstall())
			fmt.Println("Removed the meshguard-agent service. Binaries and state were kept.")
			return
		}
	}

	fs, o := flags("meshguard-agent")
	fs.Parse(os.Args[1:])
	a := &agent.Agent{Version: version, StateDir: o.stateDir, ListenPort: o.port, InterfaceName: o.iface}
	if err := run(o, a); err != nil {
		slog.Error("agent exited", "err", err)
		os.Exit(1)
	}
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "meshguard-agent:", err)
		os.Exit(1)
	}
}

// installService validates the flags, saves them in the service definition
// and starts it. The socket is owned by the user who ran sudo.
func installService(args []string) error {
	fs, o := flags("meshguard-agent install")
	fs.Parse(args) // exits on unknown flags, before anything is installed
	if o.socketOwner == "" {
		if uid, gid := os.Getenv("SUDO_UID"), os.Getenv("SUDO_GID"); uid != "" && gid != "" {
			args = append(args, "-socket-owner", uid+":"+gid)
		}
	}
	if err := service.Install(args); err != nil {
		return err
	}
	fmt.Println("Installed and started meshguard-agent:", service.Describe())
	fmt.Println("It starts at boot. Check it with: meshguard status")
	return nil
}

func run(o *options, a *agent.Agent) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := ipc.Listen(o.socket)
	if err != nil {
		return err
	}
	if uid, ok := shareSocket(o.socket, o.socketOwner); ok {
		a.Operators = append(a.Operators, uid)
	}

	srv := &http.Server{Handler: a.Handler(), ConnContext: ipc.ConnContext}
	done := make(chan struct{})
	go func() {
		a.Run(ctx) // returns after ctx is done and WireGuard is torn down
		close(done)
	}()
	go func() {
		<-ctx.Done()
		srv.Shutdown(context.Background())
	}()

	slog.Info("agent listening", "socket", o.socket, "state", a.StateDir)
	defer func() { <-done }()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// shareSocket lets one non-root user use the CLI without sudo: the owner from
// -socket-owner, or the user who ran `sudo meshguard-agent`. It returns that user's
// uid, which the agent then accepts as an operator.
func shareSocket(socket, owner string) (uint32, bool) {
	if os.Geteuid() != 0 {
		return 0, false
	}
	if owner == "" {
		if uid, gid := os.Getenv("SUDO_UID"), os.Getenv("SUDO_GID"); uid != "" && gid != "" {
			owner = uid + ":" + gid
		}
	}
	if owner == "" {
		return 0, false
	}
	uidText, gidText, _ := strings.Cut(owner, ":")
	uid, err1 := strconv.Atoi(uidText)
	gid, err2 := strconv.Atoi(gidText)
	if err1 != nil || err2 != nil {
		slog.Warn("invalid -socket-owner, want uid:gid", "value", owner)
		return 0, false
	}
	if err := os.Chown(socket, uid, gid); err != nil {
		slog.Warn("could not share socket", "owner", owner, "err", err)
		return 0, false
	}
	return uint32(uid), true
}
