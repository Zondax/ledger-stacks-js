import StacksApp from '../src'

const CLA = 0x09
const INS_GET_ADDR_MULTISIG = 0x07
const PATH = "m/44'/5757'/0'/0/0"
const COSIGNER_0 = '03c00170321c5ce931d3201927ff6b1993c350f72af5483b9d75e8505ef10aed8c'
const COSIGNER_1 = '0250863ad64a87ae8a2fe83c1af1a8403cb53f53e486d8511dad8a04887e5b2352'

// A device-like response: [pubkey(33) | address(ascii) | SW(2)]
function fakeAddrResponse(): Buffer {
  return Buffer.concat([Buffer.alloc(33, 0x02), Buffer.from('SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G'), Buffer.from([0x90, 0x00])])
}

function makeApp() {
  const calls: any[] = []
  const transport: any = {
    send: (cla: number, ins: number, p1: number, p2: number, data: Buffer, status: number[]) => {
      calls.push({ cla, ins, p1, p2, data, status })
      return Promise.resolve(fakeAddrResponse())
    },
  }
  return { app: new StacksApp(transport), calls }
}

describe('multisig address APDU (chunked)', () => {
  test('2-of-3: INIT carries the path, LAST carries the header + keys', async () => {
    const { app, calls } = makeApp()
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 1,
      cosignerPublicKeys: [COSIGNER_0, COSIGNER_1],
    })

    expect(calls).toHaveLength(2)

    // INIT chunk: the device path only
    expect(calls[0].cla).toBe(CLA)
    expect(calls[0].ins).toBe(INS_GET_ADDR_MULTISIG)
    expect(calls[0].p1).toBe(0x00) // INIT
    expect(calls[0].p2).toBe(0x00)
    expect(calls[0].data.length).toBe(20) // serialized path

    // LAST chunk: confirm | version | hash_mode | m | n | device_index | keys
    const last = calls[1]
    expect(last.p1).toBe(0x02) // LAST
    expect(last.p2).toBe(0x00)
    expect(last.data.length).toBe(6 + 33 * 2)
    expect(last.data[0]).toBe(0) // confirm = retrieve
    expect(last.data[1]).toBe(20) // version (mainnet multisig)
    expect(last.data[2]).toBe(0x01) // P2SH
    expect(last.data[3]).toBe(2) // m
    expect(last.data[4]).toBe(3) // n
    expect(last.data[5]).toBe(1) // device index
    expect(last.data.subarray(6, 39).toString('hex')).toBe(COSIGNER_0)
    expect(last.data.subarray(39, 72).toString('hex')).toBe(COSIGNER_1)
  })

  test('show sets confirm=1 and version in the payload', async () => {
    const { app, calls } = makeApp()
    await app.showMultisigAddressAndPubKey(PATH, 21 as any, {
      numRequired: 1,
      deviceKeyIndex: 0,
      cosignerPublicKeys: [COSIGNER_0],
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].p1).toBe(0x00) // INIT
    expect(calls[1].p1).toBe(0x02) // LAST
    expect(calls[1].data[0]).toBe(1) // confirm = show
    expect(calls[1].data[1]).toBe(21) // testnet multisig version
    expect(calls[1].data[4]).toBe(2) // n = 1 cosigner + device
  })

  test('accepts Buffer cosigner keys', async () => {
    const { app, calls } = makeApp()
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 2,
      cosignerPublicKeys: [Buffer.from(COSIGNER_0, 'hex'), Buffer.from(COSIGNER_1, 'hex')],
    })
    expect(calls[1].data[5]).toBe(2) // device index
  })

  test('non-sequential hash mode (0x05) travels in the header', async () => {
    const { app, calls } = makeApp()
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 1,
      cosignerPublicKeys: [COSIGNER_0, COSIGNER_1],
      hashMode: 0x05,
    })
    expect(calls[1].data[2]).toBe(0x05)
  })

  test('large key sets are split across multiple chunks', async () => {
    const { app, calls } = makeApp()
    // 14 cosigners + device = 15 keys; body = 6 + 14*33 = 468 bytes > CHUNK_SIZE (250)
    const cosigners = Array(14).fill(COSIGNER_0)
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 15,
      deviceKeyIndex: 0,
      cosignerPublicKeys: cosigners,
    })
    // INIT (path) + ADD + LAST
    expect(calls.map((c: any) => c.p1)).toEqual([0x00, 0x01, 0x02])
    expect(calls[0].data.length).toBe(20)
    // reassembled body = header(6) + 14*33
    const body = Buffer.concat([calls[1].data, calls[2].data])
    expect(body.length).toBe(6 + 14 * 33)
    expect(body[3]).toBe(15) // m
    expect(body[4]).toBe(15) // n
  })

  test.each([
    ['threshold too high', { numRequired: 4, deviceKeyIndex: 0, cosignerPublicKeys: [COSIGNER_0, COSIGNER_1] }],
    ['threshold zero', { numRequired: 0, deviceKeyIndex: 0, cosignerPublicKeys: [COSIGNER_0] }],
    ['device index out of range', { numRequired: 1, deviceKeyIndex: 2, cosignerPublicKeys: [COSIGNER_0] }],
    ['bad key length', { numRequired: 1, deviceKeyIndex: 0, cosignerPublicKeys: ['00'] }],
    ['too many keys', { numRequired: 1, deviceKeyIndex: 0, cosignerPublicKeys: Array(15).fill(COSIGNER_0) }],
  ])('rejects %s', (_name, options) => {
    const { app } = makeApp()
    // Input validation fails fast (synchronously), before any chunk is sent.
    expect(() => app.getMultisigAddressAndPubKey(PATH, 20 as any, options as any)).toThrow()
  })
})
