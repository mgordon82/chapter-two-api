const appBaseUrl = process.env.APP_BASE_URL;

export function buildInviteLink(userId: string, token: string) {
  if (!appBaseUrl) {
    throw new Error('Missing APP_BASE_URL');
  }

  return `${appBaseUrl.replace(
    /\/+$/,
    ''
  )}/invite/${userId}/${encodeURIComponent(token)}`;
}
