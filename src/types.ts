export interface ResponseBase {
  errorMessage: string
  returnCode: number
}

export interface ResponseAddress extends ResponseBase {
  publicKey: Buffer
  address: string
}

export interface MultisigAddressOptions {
  /** Number of required signatures (threshold `m`). */
  numRequired: number
  /** Position of this device's own key within the ordered multisig key set. */
  deviceKeyIndex: number
  /**
   * The other cosigners' compressed (33-byte) public keys, in the order they
   * occupy in the multisig, excluding this device's own slot. Accepts hex
   * strings or Buffers.
   */
  cosignerPublicKeys: (Buffer | string)[]
  /** Multisig hash mode. Defaults to sequential P2SH (0x01). */
  hashMode?: number
}

export interface ResponseVersion extends ResponseBase {
  testMode: boolean
  major: number
  minor: number
  patch: number
  deviceLocked: boolean
  targetId: string
}

export interface ResponseAppInfo extends ResponseBase {
  appName: string
  appVersion: string
  flagLen: number
  flagsValue: number
  flagRecovery: boolean
  flagSignedMcuCode: boolean
  flagOnboarded: boolean
  flagPINValidated: boolean
}

export interface ResponseSign extends ResponseBase {
  postSignHash: Buffer
  signatureCompact: Buffer
  signatureVRS: Buffer
  signatureDER: Buffer
}

export interface ResponseMasterFingerprint extends ResponseBase {
  fingerprint: Buffer
}

/**
 * The transport surface this package needs in order to talk to a device.
 *
 * Deliberately structural rather than a nominal dependency on `Transport` from
 * `@ledgerhq/hw-transport`: `StacksApp` only ever calls `send`, so describing that one
 * method lets it accept either a legacy `Transport` or a `DMKTransport` built on Ledger's
 * Device Management Kit, which replaces hw-transport ahead of the September 2026 cutoff.
 *
 * A `Transport` instance satisfies this interface as-is. Passing anything other than a
 * `DMKTransport` is deprecated, though: `StacksApp`'s constructor marks that overload
 * `@deprecated` and logs a one-time warning, and the next major accepts only `DMKTransport`.
 *
 * `send` must reject, with an error carrying the status word as `statusCode`, when the
 * device replies with a status word not in `statusList` -- as hw-transport's `Transport`
 * and `DMKTransport` from `@zondax/ledger-js` both do. The app relies on it: error
 * responses are built from that `statusCode`, and multi-APDU flows such as the multisig
 * address exchange do not re-check the status between chunks. A custom adapter that
 * resolves with an unaccepted status word instead would report the wrong error.
 */
export interface LedgerTransport {
  send: (
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer,
    statusList?: number[],
    options?: { abortTimeoutMs?: number }
  ) => Promise<Buffer>
}
