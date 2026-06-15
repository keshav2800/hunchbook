/** Shared client/server profile validation — one source of truth. */

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const BIO_MAX = 160;

export interface ProfileFields {
  username: string;
  email: string;
  bio: string;
}

/** Returns a human-readable error, or null when the fields are valid. */
export function validateProfile(p: ProfileFields): string | null {
  if (!USERNAME_RE.test(p.username)) {
    return 'Username must be 3–20 characters: letters, numbers, underscore.';
  }
  if (p.email !== '' && !EMAIL_RE.test(p.email)) {
    return 'That email address doesn’t look right.';
  }
  if (p.bio.length > BIO_MAX) {
    return `Bio must be ${BIO_MAX} characters or fewer.`;
  }
  return null;
}
