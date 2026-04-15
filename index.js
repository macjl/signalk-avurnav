'use strict'

const https = require('https')
const crypto = require('crypto')

const WFS_BASE = 'https://services.ping-info-nautique.fr/geoserver/nw/wfs'
const PING_PORTAL = 'https://portail.ping-info-nautique.fr/avurnav-notice'

// Centre géographique de la France métropolitaine — utilisé pour les avis sans géométrie
const FRANCE_CENTER = { lat: 46.0, lon: 2.0 }

const ALL_SERIES = [
  'NAVAREA II',
  'AVURNAV CHERBOURG',
  'AVURNAV LOCAL CHERBOURG',
  'AVIRADE CHERBOURG',
  'AVINAV CHERBOURG',
  'AVURNAV BREST',
  'AVURNAV LOCAL BREST',
  'AVIRADE BREST',
  'AVINAV BREST',
  'AVURNAV TOULON',
  'AVURNAV LOCAL TOULON',
  'AVINAV TOULON',
  'AVURNAV FORT DE FRANCE',
  'AVURNAV LOCAL FORT DE FRANCE',
  'AVINAV FORT DE FRANCE',
  'AVURNAV CAYENNE',
  'AVURNAV LOCAL CAYENNE',
  'AVINAV CAYENNE'
]

const DEFAULT_SERIES = [
  'AVURNAV CHERBOURG',
  'AVURNAV BREST',
  'AVURNAV TOULON'
]

function seriesToLayerName (seriesName, lang) {
  const slug = seriesName.toLowerCase().replace(/\s+/g, '_')
  return 'nw:nw_published_' + slug + '_v2_' + lang
}

function mercatorToLonLat (x, y) {
  const lon = (x / 20037508.34) * 180
  let lat = (y / 20037508.34) * 180
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2)
  return [lon, lat]
}

function convertCoords (coords) {
  if (!Array.isArray(coords)) return coords
  if (typeof coords[0] === 'number') return mercatorToLonLat(coords[0], coords[1])
  return coords.map(convertCoords)
}

function convertGeometry (geom) {
  if (!geom) return null
  return Object.assign({}, geom, { coordinates: convertCoords(geom.coordinates) })
}

function centroid (coords) {
  if (!coords || coords.length === 0) return null
  const pts = coords.slice()
  if (pts.length > 1) {
    const f = pts[0]; const l = pts[pts.length - 1]
    if (f[0] === l[0] && f[1] === l[1]) pts.pop()
  }
  const lonSum = pts.reduce(function (s, p) { return s + p[0] }, 0)
  const latSum = pts.reduce(function (s, p) { return s + p[1] }, 0)
  return { lon: lonSum / pts.length, lat: latSum / pts.length }
}

function referencePoint (geom) {
  if (!geom) return null
  if (geom.type === 'Point') return { lon: geom.coordinates[0], lat: geom.coordinates[1] }
  if (geom.type === 'LineString') return centroid(geom.coordinates)
  if (geom.type === 'Polygon') return centroid(geom.coordinates[0])
  if (geom.type === 'MultiPolygon') return centroid(geom.coordinates[0][0])
  return null
}

function haversineNM (lat1, lon1, lat2, lon2) {
  const R = 3440.065
  const toRad = function (d) { return d * Math.PI / 180 }
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function deterministicUUID (str) {
  const hex = crypto.createHash('sha1').update(str).digest('hex').slice(0, 32)
  const timeHiAndVersion = '4' + hex.slice(13, 16)
  const clockSeqHiAndReserved = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16).padStart(2, '0')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    timeHiAndVersion,
    clockSeqHiAndReserved + hex.slice(18, 20),
    hex.slice(20, 32)
  ].join('-')
}

function parseParts (partsStr) {
  try { return JSON.parse(partsStr || '[]') } catch (e) { return [] }
}

function extractDateRange (parts) {
  const allRanges = parts.reduce(function (acc, p) {
    return acc.concat(p.part_info && p.part_info.featurepartdaterange ? p.part_info.featurepartdaterange : [])
  }, [])
  if (allRanges.length === 0) return { valid_from: '', valid_until: '' }

  const starts = allRanges
    .filter(function (r) { return r.date_start })
    .map(function (r) { return [r.date_start, r.time_of_day_start].filter(Boolean).join(' ') })
    .sort()
  const ends = allRanges
    .filter(function (r) { return r.date_end })
    .map(function (r) { return [r.date_end, r.time_of_day_end].filter(Boolean).join(' ') })
    .sort()

  return {
    valid_from: starts[0] || '',
    valid_until: ends[ends.length - 1] || ''
  }
}

function buildContent (parts) {
  return parts
    .map(function (p) { return (p.part_info && p.part_info.featurepartinformation) || '' })
    .filter(Boolean)
    .join('\n\n')
}

function buildTitle (props, parts) {
  const detail = parts[0] && parts[0].part_info && parts[0].part_info.featurepartwarninghazardtypedetails
  const area = props.generalarea ? props.generalarea.split(',')[0] : ''
  return [detail, props.locality, area].filter(Boolean).join(' - ') ||
    (props.nameofseries + ' ' + props.warningnumber + '/' + props.year)
}

function buildDescription (warning) {
  return [
    warning.content || '',
    '',
    'Serie : ' + warning.seriesName,
    warning.locality ? 'Localite : ' + warning.locality : '',
    warning.generalArea ? 'Zone(s) : ' + warning.generalArea : '',
    'Type : ' + (warning.hazardDetail || warning.hazardGeneral || ''),
    'Publie le : ' + (warning.publicationDate || '?'),
    'Valide du ' + (warning.valid_from || '?') + ' au ' + (warning.valid_until || '?'),
    warning.noGeometry ? '(Avis sans position geographique — affiche au centre de la France)' : '',
    warning.portalUrl ? 'Source : ' + warning.portalUrl : ''
  ].filter(Boolean).join('\n')
}

function featureToWarning (feature) {
  const p = feature.properties
  const parts = parseParts(p.parts)
  const dateRange = extractDateRange(parts)
  const geomWGS84 = convertGeometry(feature.geometry)

  // Géométrie nulle → note positionnée au centre de la France
  const noGeometry = !geomWGS84
  let resourceType = 'notes'
  if (geomWGS84 && (geomWGS84.type === 'Polygon' || geomWGS84.type === 'MultiPolygon')) {
    resourceType = 'regions'
  }

  const ref = referencePoint(geomWGS84)
  const latitude = ref ? ref.lat : FRANCE_CENTER.lat
  const longitude = ref ? ref.lon : FRANCE_CENTER.lon

  return {
    id: p.warningid,
    number: p.warningnumber + '/' + p.year,
    label: p.nameofseries + ' ' + p.warningnumber + '/' + p.year,
    seriesName: p.nameofseries,
    warningType: p.warningtype,
    publicationDate: p.publicationdate || '',
    cancellationDate: p.cancellationdate || '',
    generalArea: p.generalarea || '',
    locality: p.locality || '',
    hazardGeneral: p.warninghazardtypegeneral || '',
    hazardDetail: (parts[0] && parts[0].part_info && parts[0].part_info.featurepartwarninghazardtypedetails) || '',
    title: buildTitle(p, parts),
    content: buildContent(parts),
    valid_from: dateRange.valid_from,
    valid_until: dateRange.valid_until,
    geometry: geomWGS84,
    resourceType: resourceType,
    noGeometry: noGeometry,
    latitude: latitude,
    longitude: longitude,
    portalUrl: p.warningid ? (PING_PORTAL + '/' + p.warningid) : '',
    cancelledWarnings: p.cancelledwarnings || null
  }
}

function fetchLayer (layerName) {
  const qs = 'SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&typeNames=' + encodeURIComponent(layerName) +
    '&outputFormat=' + encodeURIComponent('application/json')
  const url = WFS_BASE + '?' + qs

  return new Promise(function (resolve, reject) {
    const req = https.get(url, { timeout: 20000 }, function (res) {
      let body = ''
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' pour ' + layerName))
      }
      res.on('data', function (chunk) { body += chunk })
      res.on('end', function () {
        try {
          const geojson = JSON.parse(body)
          if (!Array.isArray(geojson.features)) {
            return reject(new Error('Reponse inattendue pour ' + layerName))
          }
          resolve(
            geojson.features
              .filter(function (f) { return f.properties && f.properties.warningid })
              .map(featureToWarning)
            // Plus de filtre sur latitude/longitude : les avis sans géométrie
            // sont maintenant positionnés au centre de la France
          )
        } catch (e) {
          reject(new Error('JSON invalide pour ' + layerName + ': ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', function () { req.destroy(); reject(new Error('Timeout ' + layerName)) })
  })
}

module.exports = function (app) {
  let plugin = {}
  let pollTimer = null
  let vesselPosition = null
  let positionUnsub = null
  let publishedRegions = new Map()
  let publishedNotes = new Map()
  let activeNotifications = new Set()

  plugin.id = 'signalk-avurnav'
  plugin.name = 'AVURNAV - PING'
  plugin.description = 'Publie les avertissements nautiques PING en vigueur (notes, regions, notifications)'

  plugin.schema = {
    type: 'object',
    properties: {
      series: {
        type: 'array',
        title: 'Series PING a surveiller',
        description: 'Selectionner les series souhaitees',
        items: { type: 'string', enum: ALL_SERIES },
        uniqueItems: true,
        default: DEFAULT_SERIES
      },
      language: {
        type: 'string',
        title: 'Langue des messages',
        enum: ['fr', 'en'],
        default: 'fr'
      },
      pollInterval: {
        type: 'number',
        title: 'Intervalle de mise a jour (secondes)',
        default: 3600,
        minimum: 60
      },
      maxDistance: {
        type: 'number',
        title: 'Distance maximale pour notification (NM)',
        description: 'Au-dela, la ressource reste publiee sur la carte mais sans notification',
        default: 100,
        minimum: 1
      },
      distanceWarn: {
        type: 'number',
        title: 'Seuil WARN - orange (NM)',
        description: 'En dessous de cette distance : notification warn (+ son)',
        default: 10,
        minimum: 1
      },
      distanceAlarm: {
        type: 'number',
        title: 'Seuil ALARM - rouge (NM)',
        description: 'En dessous de cette distance : notification alarm (+ son)',
        default: 1,
        minimum: 0.1
      }
    }
  }

  plugin.start = function (options) {
    const opts = normalizeOptions(options)
    app.debug('Demarrage — series: ' + opts.series.join(', ') + ', maxDist: ' + opts.maxDistance + ' NM, poll: ' + opts.pollInterval + 's')

    positionUnsub = app.streambundle
      .getSelfStream('navigation.position')
      .onValue(function (pos) {
        if (pos && typeof pos.latitude === 'number' && typeof pos.longitude === 'number') {
          vesselPosition = { lat: pos.latitude, lon: pos.longitude }
        }
      })

    runPoll(opts)
    pollTimer = setInterval(function () { runPoll(opts) }, opts.pollInterval * 1000)
  }

  plugin.stop = function () {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (positionUnsub) { positionUnsub(); positionUnsub = null }

    // Effacer toutes les notifications actives
    activeNotifications.forEach(function (path) {
      app.handleMessage(plugin.id, { updates: [{ values: [{ path: path, value: null }] }] })
    })
    activeNotifications.clear()

    // Supprimer toutes les ressources publiées du serveur SK
    const regionUUIDs = [...publishedRegions.keys()]
    const noteUUIDs = [...publishedNotes.keys()]
    cleanupResources(regionUUIDs, noteUUIDs)
    publishedRegions.clear()
    publishedNotes.clear()

    app.debug('Plugin arrete — ' + regionUUIDs.length + ' region(s) et ' + noteUUIDs.length + ' note(s) supprimees')
  }

  function normalizeOptions (options) {
    return {
      series: Array.isArray(options.series) && options.series.length > 0 ? options.series : DEFAULT_SERIES,
      language: options.language || 'fr',
      pollInterval: options.pollInterval || 3600,
      maxDistance: options.maxDistance || 100,
      distanceWarn: options.distanceWarn !== undefined ? options.distanceWarn : 10,
      distanceAlarm: options.distanceAlarm !== undefined ? options.distanceAlarm : 1
    }
  }

  plugin.registerWithRouter = function () {}

  async function runPoll (opts) {
    app.debug('Poll WFS PING...')
    let allWarnings = []

    for (const seriesName of opts.series) {
      const layerName = seriesToLayerName(seriesName, opts.language)
      try {
        const list = await fetchLayer(layerName)
        app.debug('  ' + seriesName + ': ' + list.length + ' avertissement(s)')
        allWarnings = allWarnings.concat(list)
      } catch (err) {
        app.debug('  ' + seriesName + ': ' + err.message)
      }
    }

    const byId = new Map()
    for (const w of allWarnings) {
      if (!byId.has(w.id)) byId.set(w.id, w)
    }
    const warnings = [...byId.values()]
    app.debug('Total: ' + warnings.length + ' avertissement(s) uniques')

    const validRegionUUIDs = new Set()
    const validNoteUUIDs = new Set()

    for (const warning of warnings) {
      let regionUUID = null

      if (warning.resourceType === 'regions') {
        regionUUID = deterministicUUID('ping-region-' + warning.id)
        validRegionUUIDs.add(regionUUID)
        await publishRegion(regionUUID, warning)
        publishedRegions.set(regionUUID, warning.id)
      }

      const noteUUID = deterministicUUID('ping-note-' + warning.id)
      validNoteUUIDs.add(noteUUID)
      await publishNote(noteUUID, regionUUID, warning)
      publishedNotes.set(noteUUID, warning.id)

      updateNotification(warning.id, warning, opts)
    }

    const staleRegions = [...publishedRegions.keys()].filter(function (u) { return !validRegionUUIDs.has(u) })
    const staleNotes = [...publishedNotes.keys()].filter(function (u) { return !validNoteUUIDs.has(u) })

    if (staleRegions.length + staleNotes.length > 0) {
      app.debug('Nettoyage: ' + staleRegions.length + ' region(s), ' + staleNotes.length + ' note(s)')
      staleRegions.forEach(function (u) {
        const warningId = publishedRegions.get(u)
        if (warningId) clearNotification(notificationPath(warningId))
        publishedRegions.delete(u)
      })
      staleNotes.forEach(function (u) { publishedNotes.delete(u) })
      cleanupResources(staleRegions, staleNotes)
    }
  }

  async function publishRegion (uuid, warning) {
    const resource = {
      name: warning.label,
      description: buildDescription(warning),
      feature: {
        type: 'Feature',
        geometry: warning.geometry,
        properties: {
          name: warning.label,
          description: warning.title,
          category: 'ping-navigational-warning',
          url: warning.portalUrl,
          valid_from: warning.valid_from,
          valid_until: warning.valid_until,
          series: warning.seriesName,
          locality: warning.locality,
          generalArea: warning.generalArea,
          hazardGeneral: warning.hazardGeneral,
          hazardDetail: warning.hazardDetail,
          warningId: warning.id,
          source: 'signalk-avurnav'
        }
      }
    }
    try {
      await app.resourcesApi.setResource('regions', uuid, resource)
    } catch (err) {
      app.error('Erreur region ' + uuid + ': ' + err.message)
    }
  }

  async function publishNote (noteUUID, regionUUID, warning) {
    const resource = {
      name: warning.label,
      description: buildDescription(warning),
      position: { latitude: warning.latitude, longitude: warning.longitude },
      mimeType: 'text/plain',
      url: warning.portalUrl
    }
    if (regionUUID) {
      resource.href = '/resources/regions/' + regionUUID
    }
    try {
      await app.resourcesApi.setResource('notes', noteUUID, resource)
    } catch (err) {
      app.error('Erreur note ' + noteUUID + ': ' + err.message)
    }
  }

  function notificationPath (warningId) {
    return 'notifications.navigation.avurnav.' + deterministicUUID('ping-alarm-' + warningId).replace(/-/g, '')
  }

  function updateNotification (warningId, warning, opts) {
    const path = notificationPath(warningId)
    if (!vesselPosition) return

    // Les avis sans géométrie (positionnés au centre de la France) ne génèrent pas de notification
    if (warning.noGeometry) return

    const dist = haversineNM(vesselPosition.lat, vesselPosition.lon, warning.latitude, warning.longitude)
    app.debug(warning.label + ': ' + dist.toFixed(1) + ' NM')

    if (dist > opts.maxDistance) {
      if (activeNotifications.has(path)) clearNotification(path)
      return
    }

    // Deux niveaux seulement : alarm (très proche) et warn (proche)
    let state, method
    if (dist <= opts.distanceAlarm) {
      state = 'alarm'
      method = ['visual', 'sound']
    } else if (dist <= opts.distanceWarn) {
      state = 'warn'
      method = ['visual', 'sound']
    } else {
      // Entre distanceWarn et maxDistance : pas de notification
      if (activeNotifications.has(path)) clearNotification(path)
      return
    }

    app.handleMessage(plugin.id, {
      updates: [{
        values: [{
          path: path,
          value: {
            state: state,
            method: method,
            message: '[' + state.toUpperCase() + '] ' + warning.label + ' a ' + dist.toFixed(1) + ' NM - ' + warning.title,
            data: {
              id: warning.id,
              number: warning.number,
              series: warning.seriesName,
              title: warning.title,
              latitude: warning.latitude,
              longitude: warning.longitude,
              distanceNM: parseFloat(dist.toFixed(2)),
              url: warning.portalUrl,
              valid_from: warning.valid_from,
              valid_until: warning.valid_until,
              hazardDetail: warning.hazardDetail,
              locality: warning.locality
            }
          }
        }]
      }]
    })
    activeNotifications.add(path)
  }

  function clearNotification (path) {
    if (!activeNotifications.has(path)) return
    app.handleMessage(plugin.id, { updates: [{ values: [{ path: path, value: null }] }] })
    activeNotifications.delete(path)
  }

  function cleanupResources (regionUUIDs, noteUUIDs) {
    regionUUIDs.forEach(function (uuid) {
      app.resourcesApi.deleteResource('regions', uuid)
        .catch(function (err) { app.debug('Erreur suppression region ' + uuid + ': ' + err.message) })
    })
    noteUUIDs.forEach(function (uuid) {
      app.resourcesApi.deleteResource('notes', uuid)
        .catch(function (err) { app.debug('Erreur suppression note ' + uuid + ': ' + err.message) })
    })
  }

  return plugin
}
