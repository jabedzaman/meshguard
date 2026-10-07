package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// browserLogin enrolls through the web instead of a token: it asks the control
// plane for a login, shows the URL where a signed-in user approves it for a
// network, and waits for the enrollment token that approval mints. The token
// then goes through the same path as `up --token`, so the device belongs to
// whoever approved it.
func browserLogin(ctx context.Context, server string, noBrowser bool) (string, error) {
	hostname, _ := os.Hostname()
	hostname = strings.TrimSuffix(strings.SplitN(hostname, ".", 2)[0], ".local")

	var start struct {
		Secret          string `json:"secret"`
		UserCode        string `json:"userCode"`
		VerificationURL string `json:"verificationUrl"`
		ExpiresIn       int    `json:"expiresIn"`
		Interval        int    `json:"interval"`
	}
	if err := postJSON(ctx, server+"/v1/device-logins", map[string]string{
		"hostname": hostname,
		"platform": runtime.GOOS,
	}, &start); err != nil {
		return "", fmt.Errorf("starting browser login: %w", err)
	}

	fmt.Printf("To connect this device, open:\n\n  %s\n\nand check that the code is %s.\n", start.VerificationURL, start.UserCode)
	if !noBrowser && openBrowser(start.VerificationURL) {
		fmt.Println("\nOpened it in your browser.")
	}
	fmt.Println("\nWaiting for approval (Ctrl+C to cancel)...")

	interval := time.Duration(start.Interval) * time.Second
	if interval <= 0 {
		interval = 2 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(start.ExpiresIn)*time.Second)
	defer cancel()
	for {
		select {
		case <-ctx.Done():
			return "", errors.New("the login expired or was cancelled: run meshguard up again")
		case <-time.After(interval):
		}
		var poll struct {
			Status string `json:"status"`
			Token  string `json:"token"`
		}
		err := postJSON(ctx, server+"/v1/device-logins/poll", map[string]string{"secret": start.Secret}, &poll)
		var gone errNotFound
		switch {
		case errors.As(err, &gone):
			return "", errors.New("the login was denied or expired: run meshguard up again")
		case err != nil:
			// Transient (network blip): keep waiting until the login expires.
			continue
		case poll.Status == "approved":
			return poll.Token, nil
		}
	}
}

type errNotFound struct{}

func (errNotFound) Error() string { return "not found" }

func postJSON(ctx context.Context, url string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return errNotFound{}
	}
	if res.StatusCode >= 300 {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&e)
		if e.Error.Message != "" {
			return errors.New(e.Error.Message)
		}
		return fmt.Errorf("control plane returned %s", res.Status)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

// openBrowser reports whether it started a browser. Failing is fine: the URL is printed.
func openBrowser(url string) bool {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		// Under sudo the browser belongs to the invoking user, which xdg-open can't reach.
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return false
		}
		cmd = exec.Command("xdg-open", url)
	default:
		return false
	}
	return cmd.Start() == nil
}
