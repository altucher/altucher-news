import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

// Weather proxy. Uses the Zeus subnet (Bittensor SN18, Orpheus AI) when
// ZEUS_API_KEY is configured, and otherwise falls back to the free, keyless
// Open-Meteo API so the weather button works today.
const ZEUS_API_URL = process.env.ZEUS_API_URL || 'https://api.myzeus.ai'
const ZEUS_API_KEY = process.env.ZEUS_API_KEY

// WMO weather interpretation codes -> human-readable conditions
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
}

export async function POST(req: NextRequest) {
  try {
    const { latitude, longitude } = await req.json()

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      return NextResponse.json(
        { error: 'Valid latitude and longitude are required' },
        { status: 400 }
      )
    }

    // Try Zeus first if configured
    if (ZEUS_API_KEY) {
      try {
        const runtime = new Date()
          .toISOString()
          .slice(0, 16)
          .replace(/[-:T]/g, '')
        const zeusUrl = `${ZEUS_API_URL.replace(/\/$/, '')}/helios/?latitude=${latitude}&longitude=${longitude}&runtime=${runtime}`
        const zeusRes = await fetch(zeusUrl, {
          headers: { 'x-api-key': ZEUS_API_KEY },
        })
        if (zeusRes.ok) {
          const zeusData = await zeusRes.json()
          return NextResponse.json({ source: 'zeus', ...zeusData })
        }
        console.log('[v0] Zeus weather error, falling back:', zeusRes.status)
      } catch (err) {
        console.log('[v0] Zeus fetch failed, falling back to Open-Meteo:', err)
      }
    }

    // Fallback: Open-Meteo (free, no key)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`

    const res = await fetch(url)
    if (!res.ok) {
      return NextResponse.json({ error: 'Weather lookup failed' }, { status: 502 })
    }
    const data = await res.json()

    const current = data.current || {}
    const daily = data.daily || {}
    const code = current.weather_code

    return NextResponse.json({
      source: 'open-meteo',
      locationName: data.timezone || 'your location',
      latitude,
      longitude,
      condition: WEATHER_CODES[code] ?? 'Unknown',
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      high: daily.temperature_2m_max?.[0],
      low: daily.temperature_2m_min?.[0],
      unit: 'F',
    })
  } catch (error) {
    console.log('[v0] Weather route error:', error)
    return NextResponse.json({ error: 'Weather lookup failed' }, { status: 500 })
  }
}
