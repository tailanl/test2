# Naval Multiplayer Server

The multiplayer server is a small Node/WebSocket service used by human multiplayer mode.
It keeps room snapshots, records JSONL events, stores dataset samples, and prepares QQ routing through an optional OneBot-compatible bridge.

## Run

```bash
npm run multiplayer:server
```

Default endpoints:

- WebSocket: `ws://127.0.0.1:8787`
- Health: `http://127.0.0.1:8787/health`
- Dataset list: `http://127.0.0.1:8787/dataset`

## Configuration

Environment variables:

- `NAVAL_MULTIPLAYER_HOST`: bind host, default `127.0.0.1`
- `NAVAL_MULTIPLAYER_PORT`: bind port, default `8787`
- `NAVAL_MULTIPLAYER_DATA_DIR`: event/dataset output directory, default `artifacts/multiplayer`
- `NAVAL_RECORDING_ENABLED`: `0` disables event recording
- `NAVAL_MAX_SNAPSHOT_BYTES`: maximum accepted snapshot size
- `NAVAL_QQ_ENABLED`: `1` enables live QQ sending
- `NAVAL_QQ_DRY_RUN`: `0` sends for real when QQ is enabled
- `NAVAL_ONEBOT_ENDPOINT`: local OneBot HTTP endpoint, for example `http://127.0.0.1:3000`
- `NAVAL_ONEBOT_TOKEN`: optional OneBot access token
- `NAVAL_QQ_GROUP_ID`: group used for all-side battlefield messages
- `NAVAL_QQ_PLAYER_MAP`: JSON map from local player id to QQ user id

You can also pass `--config path/to/config.json`. Environment values override file values.

## QQ / OneBot Local Setup

Safe local smoke test without real QQ:

```bash
npm run qq:mock
npm run multiplayer:qq
npm run qq:check -- --dispatch "Battlefield bridge dry run"
```

The local config file is `config/qq-bridge.local.json`. It is ignored by git so real QQ ids and tokens are not committed. The committed template is `config/qq-bridge.example.json`.

NapCat/LLOneBot setup target values:

- OneBot HTTP API endpoint: `http://127.0.0.1:3000` or the port you choose in the QQ bot console
- Project multiplayer server: `http://127.0.0.1:8787`
- Inbound event POST URL for the QQ bot: `http://127.0.0.1:8787/onebot/event?roomId=default`
- Optional access token: use the same value in the QQ bot console and `qq.accessToken` / `NAVAL_ONEBOT_TOKEN`

To enable real sending, set these in `config/qq-bridge.local.json` after verifying the mock flow:

```json
{
  "qq": {
    "enabled": true,
    "dryRun": false,
    "endpoint": "http://127.0.0.1:3000",
    "accessToken": "",
    "groupId": "YOUR_GROUP_ID",
    "defaultRoomId": "default",
    "inboundEnabled": true,
    "commandPrefix": "!",
    "playerMap": {
      "blue_command": "BLUE_QQ_USER_ID",
      "red_command": "RED_QQ_USER_ID"
    }
  }
}
```

Keep `dryRun: true` until `npm run qq:check` reports the expected route and login info. The server records outbound route plans and inbound QQ events in `artifacts/multiplayer/events.jsonl`; the mock OneBot records sent messages in `artifacts/qq-mock/messages.jsonl`.

## Message Routing

The server supports `qq_dispatch` messages.

- `visibility: "all"` routes to the configured QQ group.
- `visibility: "private", faction: "player"` routes privately to blue-side mapped players.
- `visibility: "private", faction: "enemy"` routes privately to red-side mapped players.
- Player `qqUserId` values in the game snapshot override or extend `NAVAL_QQ_PLAYER_MAP`.

Dry run is on by default. In dry run, the server returns `qq_route_plan` without sending messages.

## Dataset Capture

Dataset samples are stored as JSONL in `dataset.jsonl`.

Each sample contains:

- `scenario`
- `instruction`
- `fleetIds`
- `actorPlayerId`
- `beforeSnapshot`
- `afterSnapshot`
- `action`
- `label`
- `tags`
- `notes`

The Web panel can capture the before state, let a human perform the action, then save the after state.
Samples can be listed, updated, and soft-deleted from the Web panel or HTTP API.
