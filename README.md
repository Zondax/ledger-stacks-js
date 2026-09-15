# @zondax/ledger-stacks

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![npm version](https://badge.fury.io/js/%40zondax%2Fledger-stacks.svg)](https://badge.fury.io/js/%40zondax%2Fledger-stacks)

This package provides a basic client library to communicate with the Stacks App running in a Ledger Nano S+/X, Flex, Stax and Apex

We recommend using the npmjs package to receive updates/fixes.

## Transports

`StacksApp` accepts any transport that can send an APDU: a legacy `Transport` from
`@ledgerhq/hw-transport`, or a [Device Management Kit](https://www.ledger.com/blog-dmk-rollout)
session wrapped in `DMKTransport`, which this package re-exports.

```ts
import StacksApp, { DMKTransport } from '@zondax/ledger-stacks'

const sessionId = await dmk.connect({
  device,
  // A DMK session polls the device roughly once a second over the same queue your APDUs
  // leave on, and signing sends an awaited sequence of chunks. Disable it, as Ledger Live
  // does in its own DMK transport.
  sessionRefresherOptions: { isRefresherDisabled: true },
})

const app = new StacksApp(new DMKTransport(dmk, sessionId))
```

Passing anything other than a `DMKTransport` is deprecated: that constructor overload is
marked `@deprecated`, logs a one-time warning, and is removed in the next major version.

## Development

### Available Scripts

```bash
# Build the project
pnpm build

# Format code and sort package.json
pnpm format

# Check formatting
pnpm format:check

# Run linter
pnpm lint

# Fix linting issues
pnpm lint:fix

# Run tests (builds first)
pnpm test

# Check for dependency updates
pnpm upgrade
```

## Notes

Use `pnpm install` to avoid issues.
