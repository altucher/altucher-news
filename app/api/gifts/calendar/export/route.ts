import { createClient } from '@/lib/supabase/server'

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data, error } = await supabase
    .from('gift_occasions')
    .select('id, name, give_by, gift_recipients!inner(name)')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('give_by')
  if (error) return new Response(error.message, { status: 500 })

  const events = (data || []).map((item: any) => {
    const recipient = Array.isArray(item.gift_recipients) ? item.gift_recipients[0]?.name : item.gift_recipients?.name
    const date = String(item.give_by).replaceAll('-', '')
    const next = new Date(`${item.give_by}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    const end = next.toISOString().slice(0, 10).replaceAll('-', '')
    return ['BEGIN:VEVENT', `UID:${item.id}@giftfinder`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${escapeIcs(`${item.name} gift for ${recipient || 'recipient'}`)}`, 'END:VEVENT'].join('\r\n')
  })
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BlueTAO//GiftFinder//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n')
  return new Response(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="giftfinder-calendar.ics"' } })
}
