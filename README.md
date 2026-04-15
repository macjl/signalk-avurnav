# signalk-avurnav

Plugin SignalK qui publie les **avertissements nautiques français** (AVURNAV, AVINAV, NAVAREA) en vigueur, issus de la plateforme [PING](https://portail.ping-info-nautique.fr/) du SHOM.

## Fonctionnalités

- Interroge l'API WFS de PING pour toutes les séries disponibles (Cherbourg, Brest, Toulon, Fort-de-France, Cayenne, NAVAREA II…)
- Publie chaque avertissement comme **région** (polygones) ou **note** (points, lignes) dans SignalK → affichage natif dans FreeboardSK
- Les avertissements sans géométrie (ex. bulletins de synthèse) sont publiés comme notes positionnées au centre de la France
- Émet des notifications `alert` selon la position du bateau :
  - **Polygones** : alerte dès que le bateau **entre dans la zone**
  - **Points / Lignes** : alerte quand le bateau est **dans le rayon configuré** (défaut : 1 NM)
- Chaque note contient un **lien direct** vers la fiche de l'avertissement sur le portail PING
- Nettoyage automatique des ressources et notifications obsolètes entre chaque poll

## Prérequis

- SignalK Server v2+
- Plugin `@signalk/resources-provider` (inclus par défaut dans SignalK) actif
- Position du bateau disponible dans SignalK (`navigation.position`)

## Installation

Depuis l'interface d'administration SignalK → Plugin Store, rechercher `signalk-avurnav`.

Ou manuellement :
```bash
npm install signalk-avurnav
```

## Configuration

| Paramètre | Défaut | Description |
|---|---|---|
| `series` | AVURNAV CHERBOURG, BREST, TOULON | Séries à interroger (liste à cocher) |
| `language` | `fr` | Langue des messages (`fr` ou `en`) |
| `pollInterval` | `3600` s | Intervalle de rafraîchissement |
| `distanceAlert` | `1` NM | Rayon d'alerte pour les points/lignes |

### Séries disponibles

| Façade | Séries |
|---|---|
| Mondial | `NAVAREA II` |
| Manche / Mer du Nord | `AVURNAV CHERBOURG`, `AVURNAV LOCAL CHERBOURG`, `AVIRADE CHERBOURG`, `AVINAV CHERBOURG` |
| Atlantique | `AVURNAV BREST`, `AVURNAV LOCAL BREST`, `AVIRADE BREST`, `AVINAV BREST` |
| Méditerranée | `AVURNAV TOULON`, `AVURNAV LOCAL TOULON`, `AVINAV TOULON` |
| Antilles | `AVURNAV FORT DE FRANCE`, `AVURNAV LOCAL FORT DE FRANCE`, `AVINAV FORT DE FRANCE` |
| Guyane | `AVURNAV CAYENNE`, `AVURNAV LOCAL CAYENNE`, `AVINAV CAYENNE` |

## Ressources publiées

### Régions (`/resources/regions`)
Les avertissements à géométrie **polygone** sont publiés comme régions SignalK. Visibles dans FreeboardSK sous le layer "Regions". Une notification `alert` est déclenchée dès que le bateau entre à l'intérieur de la zone.

### Notes (`/resources/notes`)
Les avertissements à géométrie **point** ou **ligne** (et ceux sans géométrie) sont publiés comme notes SignalK. Visibles dans FreeboardSK sous le layer "Notes". Chaque note contient le texte complet de l'avertissement et un lien vers sa fiche sur le portail PING. Une notification `alert` est déclenchée quand le bateau est dans le rayon `distanceAlert`.

### Notifications
```
notifications.navigation.avurnav.<id>
```

Structure de chaque notification :
```json
{
  "state": "alert",
  "method": ["visual", "sound"],
  "message": "[ALERT] AVURNAV TOULON 244/2026 — inside zone — Exercice de tir",
  "data": {
    "id": "825f3ba4-...",
    "number": "244/2026",
    "series": "AVURNAV TOULON",
    "title": "Exercice de tir — PROVENCE",
    "latitude": 43.2,
    "longitude": 5.5,
    "insideZone": true,
    "url": "https://portail.ping-info-nautique.fr/avurnav-notice/825f3ba4-...",
    "valid_from": "2026-04-15 04:00:00",
    "valid_until": "2026-04-15 13:59:00"
  }
}
```

## Source de données

[PING](https://portail.ping-info-nautique.fr/) — Plateforme nationale de l'information nautique, co-éditée par le [SHOM](https://www.shom.fr/) et la DGAMPA. Données librement accessibles via l'API WFS OGC.

## Licence

MIT
