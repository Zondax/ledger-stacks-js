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
