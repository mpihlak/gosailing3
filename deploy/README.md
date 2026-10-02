# Deploying the regatta server

The server builds to one bundled file with no dependencies to install, so a deploy is
three steps: copy the file, restart the service, check `/health`. It runs as a systemd
**user** service, which needs no root on the host.

```sh
./deploy/deploy.sh            # martin@voyager
./deploy/deploy.sh user@host  # somewhere else
```

Deploys are manual. Nothing in CI pushes to the host.

## What lands on the host

| Path                                       | What                                       |
| ------------------------------------------ | ------------------------------------------ |
| `~/gosailing/main.js`                      | the bundle, `ws` included                  |
| `~/.config/systemd/user/gosailing.service` | the unit, written from `gosailing.service` |

The script copies the bundle under a temporary name and moves it into place, so a failed
transfer leaves the running version alone.

`node` is installed through nvm and is absent from the PATH systemd sees, so the unit
names the binary by absolute path. The script resolves that path on the host at deploy
time and substitutes it for `@NODE@`, which keeps the unit correct across a node upgrade.

Lingering must be on, or the service stops when the last login closes:

```sh
ssh martin@voyager 'loginctl enable-linger'
```

## Reaching it

The server listens on port 8080 and answers `GET /health` with its phase and the number
of sailors aboard. Tailscale funnel proxies `https://voyager.tail64dd71.ts.net` to it, so
a page served over https connects with `wss://`:

```
https://mpihlak.github.io/gosailing3/?server=wss://voyager.tail64dd71.ts.net&name=Ann
```

Add `&watch=1` to spectate instead of racing.

## Operating

```sh
ssh martin@voyager 'systemctl --user status gosailing'
ssh martin@voyager 'journalctl --user -u gosailing -f'
ssh martin@voyager 'systemctl --user restart gosailing'
```
