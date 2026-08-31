/**
 * Whether a server is behind this page, and who is signed in.
 *
 * The studio runs perfectly well with no server at all: fonts are parsed,
 * edited and exported in the browser, and projects live in IndexedDB. A
 * server adds shared storage on top of that, it does not replace it. So
 * everything here treats "no server" and "not signed in" as ordinary
 * states rather than failures.
 */

export interface ServerSession {
  /** Is there an API to talk to? */
  available: boolean
  authenticated: boolean
  username: string | null
  isStaff: boolean
}

export const OFFLINE: ServerSession = {
  available: false,
  authenticated: false,
  username: null,
  isStaff: false,
}

/**
 * Where the API lives.
 *
 * Injected by the Django template so the studio works under whatever prefix
 * it was mounted at. Absent when the build is served as a static site.
 */
interface StudioGlobals {
  __FONT_STUDIO__?: { apiRoot?: string }
}

export function apiRoot(): string | null {
  const injected = (window as unknown as StudioGlobals).__FONT_STUDIO__
  const root = injected?.apiRoot
  return typeof root === 'string' && root.length > 0 ? root : null
}

export function serverAvailable(): boolean {
  return apiRoot() !== null
}

/** Django's CSRF cookie, required on every mutating request. */
export function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // A proxy error page, a login redirect, anything but JSON.
    throw new ApiError(
      `The server returned ${response.status} but not JSON.`,
      response.status,
    )
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const root = apiRoot()
  if (root === null) {
    throw new ApiError('No server is configured for this page.', 0)
  }

  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-CSRFToken', csrfToken())
  }
  // FormData must set its own multipart boundary.
  if (
    init.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${root}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  })

  const body = await parse(response)
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${response.status}).`
    throw new ApiError(message, response.status)
  }
  return body as T
}

export async function fetchSession(): Promise<ServerSession> {
  if (!serverAvailable()) return OFFLINE
  try {
    const body = await request<{
      authenticated: boolean
      username: string | null
      isStaff: boolean
    }>('session/')
    return { available: true, ...body }
  } catch {
    // A server that cannot answer is, for our purposes, no server.
    return OFFLINE
  }
}

export async function signIn(
  username: string,
  password: string,
): Promise<ServerSession> {
  const body = await request<{ authenticated: boolean; username: string }>(
    'session/sign-in/',
    { method: 'POST', body: JSON.stringify({ username, password }) },
  )
  return {
    available: true,
    authenticated: body.authenticated,
    username: body.username,
    isStaff: false,
  }
}

export async function signOut(): Promise<ServerSession> {
  await request('session/sign-out/', { method: 'POST' })
  return { available: true, authenticated: false, username: null, isStaff: false }
}
