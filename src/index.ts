/** ******************************************************************************
 *  (c) 2019-2022 Zondax AG
 *  (c) 2016-2017 Ledger
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
import Transport from '@ledgerhq/hw-transport'
import type { AddressVersion } from '@stacks/transactions'

import { encode } from 'varuint-bitcoin'

import {
  CHUNK_SIZE,
  CLA,
  INS,
  LedgerError,
  MULTISIG_HASH_MODE,
  MULTISIG_MAX_PUBKEYS,
  P1_VALUES,
  PAYLOAD_TYPE,
  PKLEN,
  errorCodeToString,
  getVersion,
  processErrorResponse,
} from './common'
import { serializePath } from './helper'
import { MultisigAddressOptions, ResponseAddress, ResponseAppInfo, ResponseMasterFingerprint, ResponseSign, ResponseVersion } from './types'

export { LedgerError }
export * from './types'

function processGetAddrResponse(response: Buffer) {
  let partialResponse = response

  const errorCodeData = partialResponse.slice(-2)
  const returnCode = (errorCodeData[0] ?? 0) * 256 + (errorCodeData[1] ?? 0)

  const publicKey = Buffer.from(partialResponse.slice(0, PKLEN))
  partialResponse = partialResponse.slice(PKLEN)

  const address = Buffer.from(partialResponse.slice(0, -2)).toString()

  return {
    publicKey,
    address,
    returnCode,
    errorMessage: errorCodeToString(returnCode),
  }
}

// Builds the chunked GET_ADDR_MULTISIG payload. Larger key sets (up to n = 15)
// exceed a single APDU, so it is sent over chunked transport:
//   INIT chunk : path(20)                           -- the device's own path
//   ADD/LAST   : confirm(1) | version(1) | hash_mode(1) | m(1) | n(1) | device_index(1)
//                | cosigner keys ((n-1) * 33)        -- split into CHUNK_SIZE pieces
// The device derives its own key and splices it in at `deviceKeyIndex`, so the
// caller only supplies the OTHER cosigner keys (ordered, device slot omitted).
function serializeMultisigChunks(path: string, version: number, options: MultisigAddressOptions, confirm: boolean): Buffer[] {
  const { numRequired, deviceKeyIndex, cosignerPublicKeys } = options
  const hashMode = options.hashMode ?? MULTISIG_HASH_MODE.P2SH

  const cosigners = cosignerPublicKeys.map(k => (Buffer.isBuffer(k) ? k : Buffer.from(k, 'hex')))
  const numPubkeys = cosigners.length + 1

  if (numPubkeys < 1 || numPubkeys > MULTISIG_MAX_PUBKEYS) {
    throw new Error(`Unsupported number of keys: ${numPubkeys} (1..${MULTISIG_MAX_PUBKEYS})`)
  }
  if (numRequired < 1 || numRequired > numPubkeys) {
    throw new Error(`Invalid threshold: ${numRequired} of ${numPubkeys}`)
  }
  if (deviceKeyIndex < 0 || deviceKeyIndex >= numPubkeys) {
    throw new Error(`deviceKeyIndex ${deviceKeyIndex} out of range (0..${numPubkeys - 1})`)
  }
  cosigners.forEach((k, i) => {
    if (k.length !== PKLEN) {
      throw new Error(`Cosigner key ${i} must be a ${PKLEN}-byte compressed public key`)
    }
  })

  const header = Buffer.from([confirm ? 1 : 0, version, hashMode, numRequired, numPubkeys, deviceKeyIndex])
  const body = Buffer.concat([header, ...cosigners])

  // INIT chunk carries the path; the header + keys are chunked into the rest.
  const chunks: Buffer[] = [serializePath(path)]
  for (let i = 0; i < body.length; i += CHUNK_SIZE) {
    chunks.push(body.subarray(i, i + CHUNK_SIZE))
  }
  return chunks
}

export default class StacksApp {
  transport

  constructor(transport: Transport) {
    this.transport = transport
    if (!transport) {
      throw new Error('Transport has not been defined')
    }
  }

  static prepareChunks(serializedPathBuffer: Buffer, message: Buffer) {
    const chunks = []

    // First chunk (only path)
    chunks.push(serializedPathBuffer)

    const messageBuffer = Buffer.from(message)

    const buffer = Buffer.concat([messageBuffer])
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      let end = i + CHUNK_SIZE
      if (i > buffer.length) {
        end = buffer.length
      }
      chunks.push(buffer.slice(i, end))
    }

    return chunks
  }

  signGetChunks(path: string, message: Buffer) {
    return StacksApp.prepareChunks(serializePath(path), message)
  }

  getVersion(): Promise<ResponseVersion> {
    return getVersion(this.transport).catch(err => processErrorResponse(err))
  }

  getAppInfo(): Promise<ResponseAppInfo> {
    return this.transport.send(0xb0, 0x01, 0, 0).then(response => {
      const errorCodeData = response.slice(-2)
      const returnCode = (errorCodeData[0] ?? 0) * 256 + (errorCodeData[1] ?? 0)

      const result: { errorMessage?: string; returnCode?: LedgerError } = {}

      let appName = 'err'
      let appVersion = 'err'
      let flagLen = 0
      let flagsValue = 0

      if (response[0] !== 1) {
        // Ledger responds with format ID 1. There is no spec for any format != 1
        result.errorMessage = 'response format ID not recognized'
        result.returnCode = LedgerError.DeviceIsBusy
      } else {
        const appNameLen = response[1] ?? 0
        appName = response.slice(2, 2 + appNameLen).toString('ascii')
        let idx = 2 + appNameLen
        const appVersionLen = response[idx] ?? 0
        idx += 1
        appVersion = response.slice(idx, idx + appVersionLen).toString('ascii')
        idx += appVersionLen
        const appFlagsLen = response[idx] ?? 0
        idx += 1
        flagLen = appFlagsLen
        flagsValue = response[idx] ?? 0
      }

      return {
        returnCode,
        errorMessage: errorCodeToString(returnCode),
        //
        appName,
        appVersion,
        flagLen,
        flagsValue,
        flagRecovery: (flagsValue & 1) !== 0,

        flagSignedMcuCode: (flagsValue & 2) !== 0,

        flagOnboarded: (flagsValue & 4) !== 0,

        flagPINValidated: (flagsValue & 128) !== 0,
      }
    }, processErrorResponse)
  }

  getAddressAndPubKey(path: string, version: AddressVersion): Promise<ResponseAddress> {
    const serializedPath = serializePath(path)
    return this.transport
      .send(CLA, INS.GET_ADDR_SECP256K1, P1_VALUES.ONLY_RETRIEVE, version, serializedPath, [0x9000])
      .then(processGetAddrResponse, processErrorResponse)
  }

  getIdentityPubKey(path: string): Promise<ResponseAddress> {
    const serializedPath = serializePath(path)
    return this.transport
      .send(CLA, INS.GET_AUTH_PUBKEY, P1_VALUES.ONLY_RETRIEVE, 0, serializedPath, [0x9000])
      .then(processGetAddrResponse, processErrorResponse)
  }

  getMasterFingerprint(): Promise<ResponseMasterFingerprint> {
    return this.transport.send(CLA, INS.GET_MASTER_FINGERPRINT, 0, 0, Buffer.alloc(0), [LedgerError.NoErrors]).then((response: Buffer) => {
      const errorCodeData = response.slice(-2)
      const returnCode = (errorCodeData[0] ?? 0) * 256 + (errorCodeData[1] ?? 0)

      if (returnCode !== LedgerError.NoErrors) {
        return {
          returnCode,
          errorMessage: errorCodeToString(returnCode),
          fingerprint: Buffer.alloc(0),
        }
      }

      const fingerprint = response.slice(0, 4) // Master fingerprint is 4 bytes

      return {
        returnCode,
        errorMessage: errorCodeToString(returnCode),
        fingerprint,
      }
    }, processErrorResponse)
  }

  showAddressAndPubKey(path: string, version: AddressVersion): Promise<ResponseAddress> {
    const serializedPath = serializePath(path)
    return this.transport
      .send(CLA, INS.GET_ADDR_SECP256K1, P1_VALUES.SHOW_ADDRESS_IN_DEVICE, version, serializedPath, [LedgerError.NoErrors])
      .then(processGetAddrResponse, processErrorResponse)
  }

  /**
   * Derive a multisig (P2SH) address. The device derives its own key from
   * `path` and combines it with the supplied cosigner keys to compute the
   * address; the response's `publicKey` is this device's own key.
   *
   * `version` is the c32 multisig version byte (20 mainnet `SM…`, 21 testnet `SN…`).
   */
  getMultisigAddressAndPubKey(path: string, version: AddressVersion, options: MultisigAddressOptions): Promise<ResponseAddress> {
    const chunks = serializeMultisigChunks(path, version, options, false)
    return this.sendMultisigChunks(chunks)
  }

  /** Same as {@link getMultisigAddressAndPubKey} but shows the address on-device for verification. */
  showMultisigAddressAndPubKey(path: string, version: AddressVersion, options: MultisigAddressOptions): Promise<ResponseAddress> {
    const chunks = serializeMultisigChunks(path, version, options, true)
    return this.sendMultisigChunks(chunks)
  }

  // Sends the multisig chunks in order (INIT, ADD…, LAST) and parses the final
  // response ([device pubkey || c32 address]). P2 is 0; the chunk type is in P1.
  private sendMultisigChunks(chunks: Buffer[]): Promise<ResponseAddress> {
    const send = async () => {
      // INIT chunk (the path); intermediate responses are just SW=9000.
      let response = await this.transport.send(CLA, INS.GET_ADDR_MULTISIG, PAYLOAD_TYPE.INIT, 0, chunks[0]!, [LedgerError.NoErrors])
      for (let i = 1; i < chunks.length; i += 1) {
        const payloadType = i === chunks.length - 1 ? PAYLOAD_TYPE.LAST : PAYLOAD_TYPE.ADD
        response = await this.transport.send(CLA, INS.GET_ADDR_MULTISIG, payloadType, 0, chunks[i]!, [LedgerError.NoErrors])
      }
      return response
    }
    return send().then(processGetAddrResponse, processErrorResponse)
  }

  signSendChunk(chunkIdx: number, chunkNum: number, chunk: Buffer, ins: number): Promise<ResponseSign> {
    let payloadType = PAYLOAD_TYPE.ADD
    if (chunkIdx === 1) {
      payloadType = PAYLOAD_TYPE.INIT
    }
    if (chunkIdx === chunkNum) {
      payloadType = PAYLOAD_TYPE.LAST
    }

    return this.transport
      .send(CLA, ins, payloadType, 0, chunk, [
        LedgerError.NoErrors,
        LedgerError.DataIsInvalid,
        LedgerError.BadKeyHandle,
        LedgerError.SignVerifyError,
      ])
      .then((response: Buffer) => {
        const errorCodeData = response.slice(-2)
        const returnCode = (errorCodeData[0] ?? 0) * 256 + (errorCodeData[1] ?? 0)
        let errorMessage = errorCodeToString(returnCode)

        let postSignHash = Buffer.alloc(0)
        let signatureCompact = Buffer.alloc(0)
        let signatureVRS = Buffer.alloc(0)
        let signatureDER = Buffer.alloc(0)

        if (
          returnCode === LedgerError.BadKeyHandle ||
          returnCode === LedgerError.DataIsInvalid ||
          returnCode === LedgerError.SignVerifyError
        ) {
          errorMessage = `${errorMessage} : ${response.slice(0, response.length - 2).toString('ascii')}`
        }

        if (returnCode === LedgerError.NoErrors && response.length > 2) {
          postSignHash = response.slice(0, 32)
          signatureCompact = response.slice(32, 97)
          signatureVRS = Buffer.alloc(65)
          signatureVRS[0] = signatureCompact[signatureCompact.length - 1] ?? 0
          Buffer.from(signatureCompact).copy(signatureVRS, 1, 0, 64)
          signatureDER = response.slice(97, response.length - 2)
          return {
            postSignHash,
            signatureCompact,
            signatureVRS,
            signatureDER,
            returnCode: returnCode,
            errorMessage: errorMessage,
          }
        }

        return {
          returnCode: returnCode,
          errorMessage: errorMessage,
        }
      }, processErrorResponse)
  }

  async sign(path: string, message: Buffer) {
    try {
      const chunks = this.signGetChunks(path, message)
      let result = {
        returnCode: 0,
        errorMessage: '',
        postSignHash: null as null | Buffer,
        signatureCompact: null as null | Buffer,
        signatureDER: null as null | Buffer,
      }
      const response = await this.signSendChunk(1, chunks.length, chunks[0]!, INS.SIGN_SECP256K1)
      result.returnCode = response.returnCode
      result.errorMessage = response.errorMessage
      for (let i = 1; i < chunks.length; i += 1) {
        result = await this.signSendChunk(1 + i, chunks.length, chunks[i]!, INS.SIGN_SECP256K1)
        if (result.returnCode !== LedgerError.NoErrors) {
          break
        }
      }
      return result
    } catch (e) {
      return processErrorResponse(e)
    }
  }

  async sign_msg(path: string, message: string) {
    try {
      const len = Buffer.from(encode(message.length).buffer)
      const stacks_message = '\x17Stacks Signed Message:\n'
      const blob = Buffer.concat([Buffer.from(stacks_message), len, Buffer.from(message)])
      const ins = INS.SIGN_SECP256K1
      const chunks = this.signGetChunks(path, blob)
      let result = {
        returnCode: 0,
        errorMessage: '',
        postSignHash: null as null | Buffer,
        signatureCompact: null as null | Buffer,
        signatureDER: null as null | Buffer,
      }
      const response = await this.signSendChunk(1, chunks.length, chunks[0]!, ins)
      result.returnCode = response.returnCode
      result.errorMessage = response.errorMessage
      for (let i = 1; i < chunks.length; i += 1) {
        result = await this.signSendChunk(1 + i, chunks.length, chunks[i]!, ins)
        if (result.returnCode !== LedgerError.NoErrors) {
          break
        }
      }
      return result
    } catch (e) {
      return processErrorResponse(e)
    }
  }

  async sign_jwt(path: string, message: string) {
    try {
      const blob = Buffer.from(message)
      const ins = INS.SIGN_JWT_SECP256K1
      const chunks = this.signGetChunks(path, blob)
      let result = {
        returnCode: 0,
        errorMessage: '',
        postSignHash: null as null | Buffer,
        signatureCompact: null as null | Buffer,
        signatureDER: null as null | Buffer,
      }
      const response = await this.signSendChunk(1, chunks.length, chunks[0]!, ins)
      result.returnCode = response.returnCode
      result.errorMessage = response.errorMessage
      for (let i = 1; i < chunks.length; i += 1) {
        result = await this.signSendChunk(1 + i, chunks.length, chunks[i]!, ins)
        if (result.returnCode !== LedgerError.NoErrors) {
          break
        }
      }
      return result
    } catch (e) {
      return processErrorResponse(e)
    }
  }

  async sign_structured_msg(path: string, domain: string, message: string) {
    try {
      const header = 'SIP018'
      const blob = Buffer.concat([Buffer.from(header), Buffer.from(domain, 'hex'), Buffer.from(message, 'hex')])
      const ins = INS.SIGN_SECP256K1
      const chunks = this.signGetChunks(path, blob)
      let result = {
        returnCode: 0,
        errorMessage: '',
        postSignHash: null as null | Buffer,
        signatureCompact: null as null | Buffer,
        signatureDER: null as null | Buffer,
      }
      const response = await this.signSendChunk(1, chunks.length, chunks[0]!, ins)
      result.returnCode = response.returnCode
      result.errorMessage = response.errorMessage
      for (let i = 1; i < chunks.length; i += 1) {
        result = await this.signSendChunk(1 + i, chunks.length, chunks[i]!, ins)
        if (result.returnCode !== LedgerError.NoErrors) {
          break
        }
      }
      return result
    } catch (e) {
      return processErrorResponse(e)
    }
  }
}
