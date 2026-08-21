import { createHmac, timingSafeEqual } from 'crypto'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/sso/admin-client'

// ============================================================
// SSO BRIDGE — logs an Innova CRM user straight into wacrm
// ============================================================
// Innova embeds wacrm in an <iframe> (see inbox.php). Without this route,
// that iframe just shows wacrm's own /login screen — a second, separate
// login the user has to type into every time, which defeats the point of
// "one integrated tool". This route lets Innova hand off an already-logged-
// in user directly into a wacrm session, no second login screen, as long as
// that person already has a wacrm account under the same email.
//
// Flow:
//   1. Innova (which knows WACRM_API_TOKEN, config.php) builds this URL,
//      signing {email, dest, exp} with HMAC-SHA256 using that shared secret.
//   2. This route verifies the signature + that it hasn't expired (60s
//      window — just long enough for the redirect chain, short enough that
//      a leaked URL is useless a minute later).
//   3. Using the Supabase *service role* (never exposed to the browser), it
//      mints a one-time magic-link token for that email and immediately
//      redeems it server-side (verifyOtp) — this is the standard supported
//      way to create a session for a user without them clicking an emailed
//      link. The resulting session cookies are attached to the redirect.
//   4. Redirects into `dest` (a wacrm route, e.g. /inbox) with ?embed=1 so
//      wacrm hides its own sidebar/header (Innova's sidebar is the only
//      menu the user sees — see dashboard-shell.tsx).
//
// Requirements for this to work:
//   - INNOVA_API_TOKEN (env var, wacrm side) must be set to the EXACT same
//     value as WACRM_API_TOKEN in Innova's config.php — this is the shared
//     secret, not a login credential.
//   - The Innova user's email must match an EXISTING wacrm account's email
//     exactly. This route never creates accounts — it only signs in to one
//     that's already there. Invite each Innova agent who needs WhatsApp
//     access as a wacrm user (Settings → Members) using their Innova email.
const ALLOWED_DEST_PREFIXES = [
  '/inbox',
  '/contacts',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/agents',
]

function isAllowedDest(dest: string): boolean {
  return ALLOWED_DEST_PREFIXES.some(
    (p) => dest === p || dest.startsWith(p + '/')
  )
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const email = url.searchParams.get('email') || ''
  const dest = url.searchParams.get('dest') || ''
  const exp = url.searchParams.get('exp') || ''
  const sig = url.searchParams.get('sig') || ''

  const secret = process.env.INNOVA_API_TOKEN
  if (!secret) {
    return NextResponse.json(
      { error: 'INNOVA_API_TOKEN no configurado en el entorno de wacrm' },
      { status: 500 }
    )
  }
  if (!email || !dest || !exp || !sig) {
    return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
  }
  if (!isAllowedDest(dest)) {
    return NextResponse.json({ error: 'dest no permitido' }, { status: 400 })
  }

  const expNum = parseInt(exp, 10)
  if (!Number.isFinite(expNum) || Date.now() / 1000 > expNum) {
    return NextResponse.json({ error: 'Enlace expirado' }, { status: 401 })
  }

  const expectedSig = createHmac('sha256', secret)
    .update(`${email}|${dest}|${exp}`)
    .digest('hex')
  if (!safeEqual(sig, expectedSig)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  // Mint + immediately redeem a magic-link token server-side (service
  // role) — no email is ever sent, this just establishes a session for an
  // account that must already exist.
  const admin = supabaseAdmin()
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink(
    { type: 'magiclink', email }
  )
  if (linkError || !linkData?.properties?.hashed_token) {
    const notFound = linkError?.message?.toLowerCase().includes('not found')
    return NextResponse.json(
      {
        error: notFound
          ? `No existe una cuenta de wacrm con el correo ${email}. Invítalo desde Settings → Members con ese mismo correo.`
          : (linkError?.message || 'No se pudo generar el enlace de acceso'),
      },
      { status: 404 }
    )
  }

  const redirectUrl = new URL(dest + '?embed=1', url.origin)
  const response = NextResponse.redirect(redirectUrl)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: linkData.properties.hashed_token,
  })
  if (verifyError) {
    return NextResponse.json(
      { error: verifyError.message || 'No se pudo iniciar sesión' },
      { status: 401 }
    )
  }

  return response
}
