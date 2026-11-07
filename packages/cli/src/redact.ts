// SPDX-License-Identifier: Apache-2.0

/**
 * Strips credential-shaped text from logs and unit files.
 * The prefix is written as a character class so the bundled script does not contain a key sample.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/rs[kw]_[A-Za-z0-9_-]+/g, 'rs[redacted]')
    .replace(/("api_key"\s*:\s*")[^"]*(")/g, '$1[redacted]$2')
    .replace(/(authorization:\s*bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/(bearer\s+)rs\S+/gi, '$1[redacted]');
}
