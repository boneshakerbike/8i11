/**
 * Maps NextAuth `?error=` codes on /login to messages that describe what
 * actually failed, so a failed sign-in can be reported and diagnosed.
 */

export type SignInErrorMessage = {
  /** Sentence shown to the user. */
  text: string;
  /** True when retrying the same sign-in is likely to work. */
  retryable: boolean;
};

const MESSAGES: Record<string, SignInErrorMessage> = {
  // Thrown by NextAuth when the /api/auth/callback/<provider> step fails:
  // an expired or missing state cookie, a failed token exchange, or a
  // timed-out call to the provider's API.
  OAuthCallback: {
    text: 'GitHub sent you back, but the sign-in could not be completed. '
      + 'This usually means the attempt timed out or sat unfinished for more than 15 minutes. Try again.',
    retryable: true,
  },
  OAuthSignin: {
    text: 'Could not start the GitHub sign-in. GitHub may be unreachable right now.',
    retryable: true,
  },
  OAuthAccountNotLinked: {
    text: 'That GitHub account is not linked to an existing account here.',
    retryable: false,
  },
  OAuthCreateAccount: {
    text: 'Could not create an account for that GitHub user.',
    retryable: false,
  },
  AccessDenied: {
    text: 'That GitHub account is not on the allow list for this site.',
    retryable: false,
  },
  Configuration: {
    text: 'The server auth configuration is incomplete. Check the deployment environment variables.',
    retryable: false,
  },
  Verification: {
    text: 'That sign-in link has expired or was already used.',
    retryable: true,
  },
  CredentialsSignin: {
    text: 'That PIN was not accepted.',
    retryable: true,
  },
  Callback: {
    text: 'The sign-in callback failed after GitHub authorised you.',
    retryable: true,
  },
};

const FALLBACK: SignInErrorMessage = {
  text: 'Sign-in failed.',
  retryable: true,
};

/** Returns the message for a NextAuth error code, or a generic fallback. */
export function sign_in_error_message(code: string | null | undefined): SignInErrorMessage {
  if (!code) return FALLBACK;
  return MESSAGES[code] ?? FALLBACK;
}
