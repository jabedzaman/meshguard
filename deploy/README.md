# Deploy

Kustomize manifests for running meshguard (api, web, workers, postgres, redis,
nats, cloudflared) on the single-node k3s cluster on `thinkpad` (Tailscale
`100.82.18.127`). Public access is a Cloudflare Tunnel, so there's no ingress or
cert-manager. Same layout as kuchupuchu's `deploy/`.

| Host                        | Service                                            |
| --------------------------- | -------------------------------------------------- |
| `meshguard.jabed.dev`       | `meshguard-web.meshguard.svc.cluster.local:3000`   |
| `meshguard-api.jabed.dev`   | `meshguard-api.meshguard.svc.cluster.local:4000`   |
| `meshguard-relay.jabed.dev` | `meshguard-relay.meshguard.svc.cluster.local:3340` |

Hostnames are one level deep on purpose: Cloudflare's free certificate covers
`*.jabed.dev` but not `*.meshguard.jabed.dev`. To change them, update
`configmap.yaml`, the tunnel routes and `NEXT_PUBLIC_API_URL` (step 2) together.

Images come from GHCR (`.github/workflows/images.yml`); migrations run in the
API pod's `migrate` init container on every rollout.

## 1. Kubeconfig

Copy k3s's kubeconfig off the node and point it at the Tailscale IP:

```sh
ssh -t thinkpad 'sudo install -m 600 -o "$USER" /etc/rancher/k3s/k3s.yaml ~/k3s.yaml'
scp thinkpad:k3s.yaml ~/.kube/homelab && ssh thinkpad 'rm ~/k3s.yaml'
sed -i 's/127.0.0.1/100.82.18.127/' ~/.kube/homelab   # macOS: sed -i ''
chmod 600 ~/.kube/homelab

export KUBECONFIG=~/.kube/homelab
kubectl get nodes
```

(Use `user@100.82.18.127` if `thinkpad` isn't an SSH alias.) If `kubectl` fails
with a certificate error for `100.82.18.127`, add the IP to the API server's
certificate on the node and restart k3s:

```sh
echo 'tls-san: ["100.82.18.127"]' | sudo tee -a /etc/rancher/k3s/config.yaml
sudo systemctl restart k3s
```

## 2. Images

The web image bakes the API URL into the browser bundle, so set it once and
rebuild:

```sh
gh variable set NEXT_PUBLIC_API_URL --body https://meshguard-api.jabed.dev
gh workflow run images.yml
```

GHCR packages start private. Either make `meshguard-api`, `meshguard-web` and
`meshguard-workers` public (GitHub → Packages → Package settings → Change
visibility), or create a pull secret and add `imagePullSecrets` to the
deployments:

```sh
kubectl -n meshguard create secret docker-registry ghcr \
  --docker-server=ghcr.io --docker-username=jabedzaman --docker-password=<PAT with read:packages>
```

## 3. Cloudflare Tunnel (one-time, dashboard)

1. Zero Trust → **Networks → Tunnels → Create a tunnel** → Cloudflared → name
   it `meshguard-thinkpad`.
2. Copy the token (the string after `--token`) into `secret.yaml` (step 4).
   Don't run the install command.
3. Add the two public hostnames from the table above, type `HTTP`.

Cloudflare creates the DNS records.

## 4. Secret

```sh
cp deploy/k8s/secret.example.yaml deploy/k8s/secret.yaml
# fill in: POSTGRES_PASSWORD (and the same in DATABASE_URL), BETTER_AUTH_SECRET
# (openssl rand -hex 32), SMTP_URL, CLOUDFLARE_TUNNEL_TOKEN
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml
```

`secret.yaml` is gitignored.

## 5. Apply

```sh
kubectl diff -k deploy/k8s     # review first
kubectl apply -k deploy/k8s
```

## 6. Verify

```sh
kubectl -n meshguard get pods
kubectl -n meshguard logs deploy/meshguard-api -c migrate
kubectl -n meshguard logs -l app=meshguard-cloudflared --tail=50
curl https://meshguard-api.jabed.dev/healthz
curl http://100.82.18.127:30400/healthz      # direct over Tailscale
```

Then sign up at https://meshguard.jabed.dev.

## Updating

Pushes to main build new `:latest` images. Roll them out with:

```sh
kubectl -n meshguard rollout restart deploy/meshguard-api deploy/meshguard-web deploy/meshguard-workers deploy/meshguard-relay
```

## Notes

- **Relay** runs WebSocket-only through the tunnel (`-stun-addr=`): the tunnel
  can't carry UDP, so agents find their public address with the public STUN
  servers in `configmap.yaml` and fall back to the relay when hole punching fails.
- **Cookies** are scoped to `jabed.dev` (`AUTH_COOKIE_DOMAIN`) so the session
  set by the API is visible to the web app on its own subdomain.
