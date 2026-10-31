# Telegram MCP plugin

Telethon user-client plugin for ARTEX.

## Login flow

1. `telegram_login_send_code` — phone like `+9198...`
2. `telegram_login_verify_code` — SMS / Telegram app code
3. `telegram_login_2fa` — only if account has cloud password
4. Then use `telegram_me` / `telegram_dialogs` / `telegram_send_message`

Session files live in `~/.artex-telegram-mcp/`.

## Run (stdio MCP)

```bash
python3 plugins/telegram-mcp/server.py
```

## Attach in ARTEX

Connections → Connect **Telegram User**  
or System → MCP → add stdio server:

- command: `python3`
- args: `/absolute/path/to/plugins/telegram-mcp/server.py`

## Temp API credentials

`api_id` / `api_hash` are hardcoded in `server.py` for now — remove or move to env later:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
