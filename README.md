# signalk-avurnav

SignalK plugin that publishes active French nautical warnings (AVURNAV, AVINAV, NAVAREA) from the [PING](https://portail.ping-info-nautique.fr/) platform operated by SHOM.

## Features

- Fetches warnings from the PING WFS API for all available series (Cherbourg, Brest, Toulon, Fort-de-France, Cayenne, NAVAREA II…)
- Publishes each warning as a SignalK **region** (polygons) or **note** (points, lines) → native display in FreeboardSK
- Warnings without geometry (e.g. summary bulletins) are published as notes positioned at the center of France
- Emits `alert` notifications based on vessel position:
  - **Polygons**: alert when the vessel **enters the zone** (point-in-polygon)
  - **Points / Lines**: alert when the vessel is **within the configured radius** (default: 1 NM)
- Each note includes a **direct link** to the warning page on the PING portal
- Automatic cleanup of obsolete resources and notifications between polls

## Requirements

- SignalK Server v2+
- `@signalk/resources-provider` plugin active (included by default in SignalK)
- Vessel position available in SignalK (`navigation.position`)

## Installation

From the SignalK admin UI → Plugin Store, search for `signalk-avurnav`.

Or manually:
```bash
npm install signalk-avurnav
```

## Configuration

| Parameter | Default | Description |
|---|---|---|
| `series` | AVURNAV CHERBOURG, BREST, TOULON | Series to fetch (checklist) |
| `language` | `fr` | Message language (`fr` or `en`) |
| `pollInterval` | `3600` s | Refresh interval |
| `distanceAlert` | `1` NM | Alert radius for points/lines |

### Available series

| Area | Series |
|---|---|
| Worldwide | `NAVAREA II` |
| English Channel / North Sea | `AVURNAV CHERBOURG`, `AVURNAV LOCAL CHERBOURG`, `AVIRADE CHERBOURG`, `AVINAV CHERBOURG` |
| Atlantic | `AVURNAV BREST`, `AVURNAV LOCAL BREST`, `AVIRADE BREST`, `AVINAV BREST` |
| Mediterranean | `AVURNAV TOULON`, `AVURNAV LOCAL TOULON`, `AVINAV TOULON` |
| Caribbean | `AVURNAV FORT DE FRANCE`, `AVURNAV LOCAL FORT DE FRANCE`, `AVINAV FORT DE FRANCE` |
| French Guiana | `AVURNAV CAYENNE`, `AVURNAV LOCAL CAYENNE`, `AVINAV CAYENNE` |

## Published resources

### Regions (`/resources/regions`)
Warnings with **polygon** geometry are published as SignalK regions, visible in FreeboardSK under the "Regions" layer. An `alert` notification is triggered when the vessel enters the zone.

### Notes (`/resources/notes`)
Warnings with **point** or **line** geometry (and those without geometry) are published as SignalK notes, visible in FreeboardSK under the "Notes" layer. Each note contains the full warning text and a link to the PING portal. An `alert` notification is triggered when the vessel is within `distanceAlert`.

### Notifications
```
notifications.navigation.avurnav.<id>
```

Notification structure:
```json
{
  "state": "alert",
  "method": ["visual", "sound"],
  "message": "[ALERT] AVURNAV TOULON 244/2026 — inside zone — Firing exercise",
  "data": {
    "id": "825f3ba4-...",
    "number": "244/2026",
    "series": "AVURNAV TOULON",
    "title": "Firing exercise — PROVENCE",
    "latitude": 43.2,
    "longitude": 5.5,
    "insideZone": true,
    "url": "https://portail.ping-info-nautique.fr/avurnav-notice/825f3ba4-...",
    "valid_from": "2026-04-15 04:00:00",
    "valid_until": "2026-04-15 13:59:00"
  }
}
```

## Data source

[PING](https://portail.ping-info-nautique.fr/) — France's national nautical information platform, co-published by [SHOM](https://www.shom.fr/) and DGAMPA. Data freely available via OGC WFS API.

## License

MIT
