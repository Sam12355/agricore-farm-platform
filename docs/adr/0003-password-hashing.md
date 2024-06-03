# ADR-0003: scrypt rather than Argon2id

**Status:** accepted
**Date:** 2026-02

## Context

Passwords need a memory-hard key derivation function. Argon2id is OWASP's current first
recommendation and won the Password Hashing Competition.

## Decision

Node's built-in `scrypt` at OWASP's minimum parameters (N=2^17, r=8, p=1), with the parameters stored
alongside the hash and upgraded opportunistically on login.

## Why

Every maintained Argon2 binding for Node needs a native build. The `argon2` package needs node-gyp.
`@node-rs/argon2` ships prebuilt binaries but still falls back to a build on any platform without one.

This repository has to clone and run on a Windows machine with no build toolchain. A dependency that
fails to install turns "read this portfolio" into "spend forty minutes installing Visual Studio build
tools", and most people will close the tab instead. That is a worse outcome than a slightly older KDF.

scrypt is memory-hard, is in the standard library with no dependency at all, and OWASP still lists it
as acceptable where Argon2id is unavailable. At N=2^17 it uses roughly 128 MB per hash, which is the
property that matters against GPU attack.

The stored format is `scrypt$N$r$p$salt$hash`. Because the parameters travel with the hash, raising
the cost later does not invalidate anyone's password: `needsRehash` spots the older parameters and
login rewrites the stored hash while the plaintext happens to be in hand.

## Consequences

**Good.** No dependency. Installs everywhere. Cost is upgradeable with no migration and no forced
password reset. The `PasswordHasher` port means swapping in Argon2id later touches one file.

**Bad.** Argon2id has better resistance to side-channel and time-memory trade-off attacks. That is a
real difference, accepted knowingly rather than overlooked.

**Also bad.** Node's default `maxmem` is 32 MB, which N=2^17 exceeds, so the call throws rather than
being slow. It has to be passed explicitly, and that is an easy thing to get wrong quietly.

## What would change this

A deployment target where a native build is guaranteed. Then Argon2id, same port, one file.
