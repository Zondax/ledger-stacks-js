/** ******************************************************************************
 *  (c) 2026 Zondax AG
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ******************************************************************************* */

export const LEGACY_TRANSPORT_DEPRECATION =
  '[@zondax/ledger-stacks] Passing a transport other than DMKTransport to StacksApp is deprecated and will be ' +
  'rejected in the next major version. Ledger deprecated @ledgerhq/hw-transport in favour of the Device ' +
  'Management Kit: wrap a DMK session instead, e.g. new StacksApp(new DMKTransport(dmk, sessionId)), with ' +
  'DMKTransport from @zondax/ledger-js.'

let legacyTransportWarned = false

/**
 * Logs {@link LEGACY_TRANSPORT_DEPRECATION} the first time it is called, and never again.
 *
 * Once per process rather than once per app: wallets construct an app per request, and a
 * warning on every construction would bury everything else in their logs.
 */
export function warnLegacyTransport(): void {
  if (legacyTransportWarned) {
    return
  }
  legacyTransportWarned = true
  // eslint-disable-next-line no-console
  console.warn(LEGACY_TRANSPORT_DEPRECATION)
}

/**
 * Forgets that the warning was logged. Test-only: not exported from the package index.
 */
export function resetLegacyTransportWarning(): void {
  legacyTransportWarned = false
}
