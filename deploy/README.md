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
of sailors aboard. A Cloudflare tunnel fronts it at `https://ws.gosailing.online`, which
is the address the game joins with `?network`. A page served over https must connect with
`wss://`, so a plain `ws://` address only works from a page served over plain http.

```
https://mpihlak.github.io/gosailing3/?network
https://mpihlak.github.io/gosailing3/?network&name=Ann
```

Add `&watch=1` to spectate instead of racing.

### Why not tailscale funnel

It was the funnel first, and the funnel routes through Tailscale's public relay even when
the player is on the same network as the server. Measured against the same server, same
session, round trip from putting the helm over to the boat answering:

| path                      | p50    | p90    | max    |
| ------------------------- | ------ | ------ | ------ |
| the house network, direct | 61 ms  | 66 ms  | 88 ms  |
| Cloudflare tunnel         | 64 ms  | 70 ms  | 94 ms  |
| tailscale funnel          | 165 ms | 366 ms | 766 ms |

The tunnel costs three milliseconds over sitting next to the server. The spread matters
as much as the middle: a boat that answers in 70 ms every time feels steered, and one
that answers anywhere between 100 and 766 feels like it is arguing.

## Operating

```sh
ssh martin@voyager 'systemctl --user status gosailing'
ssh martin@voyager 'journalctl --user -u gosailing -f'
ssh martin@voyager 'systemctl --user restart gosailing'
```
