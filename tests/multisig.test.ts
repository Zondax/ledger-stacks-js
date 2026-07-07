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

describe('multisig address APDU', () => {
  test('builds 2-of-3 payload (retrieve)', async () => {
    const { app, calls } = makeApp()
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 1,
      cosignerPublicKeys: [COSIGNER_0, COSIGNER_1],
    })

    expect(calls).toHaveLength(1)
    const { cla, ins, p1, p2, data } = calls[0]
    expect(cla).toBe(CLA)
    expect(ins).toBe(INS_GET_ADDR_MULTISIG)
    expect(p1).toBe(0x00) // retrieve only
    expect(p2).toBe(20) // mainnet multisig version

    // path(20) | hash_mode | m | n | device_index | cosigner0(33) | cosigner1(33)
    expect(data.length).toBe(20 + 4 + 33 * 2)
    expect(data[20]).toBe(0x01) // P2SH
    expect(data[21]).toBe(2) // m
    expect(data[22]).toBe(3) // n
    expect(data[23]).toBe(1) // device index
    expect(data.subarray(24, 57).toString('hex')).toBe(COSIGNER_0)
    expect(data.subarray(57, 90).toString('hex')).toBe(COSIGNER_1)
  })

  test('show uses P1=1', async () => {
    const { app, calls } = makeApp()
    await app.showMultisigAddressAndPubKey(PATH, 21 as any, {
      numRequired: 1,
      deviceKeyIndex: 0,
      cosignerPublicKeys: [COSIGNER_0],
    })
    expect(calls[0].p1).toBe(0x01)
    expect(calls[0].p2).toBe(21)
    expect(calls[0].data[22]).toBe(2) // n = 1 cosigner + device
  })

  test('accepts Buffer cosigner keys', async () => {
    const { app, calls } = makeApp()
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 2,
      cosignerPublicKeys: [Buffer.from(COSIGNER_0, 'hex'), Buffer.from(COSIGNER_1, 'hex')],
    })
    expect(calls[0].data[23]).toBe(2)
  })

  test('non-sequential hash mode (0x05) serializes into the header', async () => {
    const { app, calls } = makeApp()
    // Non-sequential P2SH derives the same address as sequential P2SH, so the
    // device accepts it; only the hash-mode byte in the header changes.
    await app.getMultisigAddressAndPubKey(PATH, 20 as any, {
      numRequired: 2,
      deviceKeyIndex: 1,
      cosignerPublicKeys: [COSIGNER_0, COSIGNER_1],
      hashMode: 0x05,
    })
    expect(calls[0].data[20]).toBe(0x05) // P2SH non-sequential
  })

  test.each([
    ['threshold too high', { numRequired: 4, deviceKeyIndex: 0, cosignerPublicKeys: [COSIGNER_0, COSIGNER_1] }],
    ['threshold zero', { numRequired: 0, deviceKeyIndex: 0, cosignerPublicKeys: [COSIGNER_0] }],
    ['device index out of range', { numRequired: 1, deviceKeyIndex: 2, cosignerPublicKeys: [COSIGNER_0] }],
    ['bad key length', { numRequired: 1, deviceKeyIndex: 0, cosignerPublicKeys: ['00'] }],
    ['too many keys', { numRequired: 1, deviceKeyIndex: 0, cosignerPublicKeys: Array(7).fill(COSIGNER_0) }],
  ])('rejects %s', (_name, options) => {
    const { app } = makeApp()
    // Input validation fails fast (synchronously), matching serializePath's convention.
    expect(() => app.getMultisigAddressAndPubKey(PATH, 20 as any, options as any)).toThrow()
  })
})
