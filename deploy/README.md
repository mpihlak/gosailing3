# Deploying the regatta server

The server and the robot sailors are two Docker images, `mpihlak/gosailing-server` and
`mpihlak/gosailing-ai`, built from the `Dockerfile` at the top of the repo. On the host
they run under docker compose.

```sh
./deploy/deploy.sh                    # both, on martin@voyager
./deploy/deploy.sh server             # the server alone; the robots reconnect to it
./deploy/deploy.sh ai                 # the robots alone
./deploy/deploy.sh all user@host      # somewhere else
```

The script builds both images for `linux/amd64` on the Mac and pushes them to Docker
Hub, so it needs a `docker login` as `mpihlak` first. It then copies `compose.yaml` to
the host, pulls, restarts the services it was given and checks `/health`. The images are
public, so the host pulls them without a login.

Each image is tagged with the commit it was built from as well as `latest`. A build from
a tree with uncommitted changes gets `-dirty` after the commit. They are two images so
that a new robot image does not make compose restart the server in the middle of a race.

Deploys are manual. Nothing in CI pushes to the host.

## What lands on the host

| Path                              | What                                     |
| --------------------------------- | ---------------------------------------- |
| `~/gosailing-docker/compose.yaml` | the services, copied from `compose.yaml` |
| `~/gosailing-docker/.env`         | settings for compose, if any             |
| `~/gosailing-docker/logs`         | the races, mounted into the server       |

`.env` can hold:

| Setting      | What                                                   |
| ------------ | ------------------------------------------------------ |
| `SERVER_TAG` | the server image to run, a commit; `latest` by default |
| `AI_TAG`     | the robots' image to run, the same way                 |
| `HOST_PORT`  | the loopback port the server is published on; 8080     |

To run an older build, set its tag there and run `docker compose up -d`. The Docker
daemon starts at boot and brings both services back; they restart if they die.

## Reaching it

The server listens on port 8080 and answers `GET /health` with its phase and the number
of sailors aboard. A Cloudflare tunnel fronts it at `https://ws.gosailing.online`, which
is the address the game's menu watches and joins. A page served over https must connect
with `wss://`, so a plain `ws://` address only works from a page served over plain http.

```
https://mpihlak.github.io/gosailing3/                     the menu
https://mpihlak.github.io/gosailing3/?network&name=Ann    straight in, racing as Ann
https://mpihlak.github.io/gosailing3/?network&watch=1     straight in, watching
```

Nobody races without a name. The server seats a sailor who gives none as a watcher.

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

Run compose from `~/gosailing-docker`, where it finds the project:

```sh
ssh martin@voyager 'cd ~/gosailing-docker && docker compose ps'
ssh martin@voyager 'cd ~/gosailing-docker && docker compose logs -f server'
ssh martin@voyager 'cd ~/gosailing-docker && docker compose restart server'
```

Docker keeps five files of 10 MB for each service's output and drops the oldest.

## The robots

Nine robot sailors run in their own container, so there is always a race on to join or
watch. They reach the server over the compose network at `ws://server:8080`, not
through the tunnel, and race each other for as long as nobody else turns up. The robots'
container starts once the server answers `/health`.

Each robot reconnects on her own when her connection drops: five seconds later, and
twice as long after each attempt that fails, up to a minute. That covers a server
restart and a server that is not up yet. A robot who gave up her seat to a person stays
away.

```sh
ssh martin@voyager 'cd ~/gosailing-docker && docker compose logs -f ai'
```

## The races on disk

Every race is written to `~/gosailing-docker/logs` as it is sailed, one file a race, named for
when it began and the id it was given: `20261003T085901Z-3a6830f6.jsonl`. Beside them
`races.jsonl` carries a line for each race that has ended, which is what a tool reads to
find one without opening every file.

```json
{
  "id": "3a6830f6",
  "file": "20261003T085901Z-3a6830f6.jsonl",
  "from": "2026-10-03T08:59:01.498Z",
  "to": "2026-10-03T08:59:15.010Z",
  "ms": 13512,
  "ending": "scored",
  "sailors": ["Blue (Remote)", "Red (Local)"]
}
```

A race file is newline-delimited JSON. The first line is the scenario and the sailors,
the last says how it ended, and between them is every message in order, each stamped with
the milliseconds since the race began:

| `t`    | what it is                                                                 |
| ------ | -------------------------------------------------------------------------- |
| `race` | the header: id, start time, seed, sailors, the whole scenario              |
| `out`  | a message the server sent, with the sailors it went to                     |
| `in`   | a helm or a command a sailor sent                                          |
| `over` | the footer: end time, how long it ran, `scored` or `abandoned`, the places |

What is recorded is the stream the clients were given, so a replayer needs no simulation
of its own: play the `out` messages at their stamped times and the game itself builds the
race from them. A race ends `abandoned` when it never reached a result — the host
restarted it, a sailor arriving before the gun made the start again, or the server
stopped.

A nineteen-second race between two boats is about 385 KB, so roughly 20 KB a second, and
a ten-boat race perhaps three times that. There is no retention: nothing deletes old
races, and with 85 GB free that is years of sailing, but it is unbounded. `gzip` gets
them down by about 3.8x if they ever need it.

## Reading the latency

Each connection is pinged twice a second and the server's output gets two kinds of line.
Add `-t` to `docker compose logs` to tie a bad stretch to a time of day.

```sh
ssh martin@voyager 'cd ~/gosailing-docker && docker compose logs --no-log-prefix server | grep latency'
```

```
latency now  Blue (Remote) n=20 p50 28ms p90 62ms max 102ms
latency race Blue (Remote) finished n=203 p50 29ms p90 57ms max 183ms
```

`latency now` is every sailor every ten seconds, over those ten seconds alone, so a line
that goes bad in the middle of a race shows as it happens. `latency race` is the whole
race, written as the result goes out. Grep for one or the other to separate them.

Percentiles rather than a mean: a line that answers in 70ms every time and one that
answers anywhere between 100 and 700 can share a median, and only the second is
unsteerable.

What this measures is the round trip of the line, not the state of whoever is on it. The
far end answers a ping in its network layer rather than its page, so a player whose phone
is dropping frames still reads clean here.
