# 0003. Deterministic desktop renderer startup

Date: 2026-07-16

## Status

Accepted

## Context

The desktop HTML synchronously requested Google Fonts before the renderer module ran. Cold startup therefore depended on external network latency and took about 2.4 seconds even after the static startup bundle was reduced. The same entry also bundled all seven translation catalogs although only the active locale and English fallback were needed.

## Decision

Desktop renderer HTML uses the existing system-font stacks and performs no startup font requests. The startup-sensitive i18next boundary loads the active locale and English fallback through an on-demand backend; later language changes load their catalog through the same backend. Language metadata remains a small independent catalog, while the complete synchronous locale registry stays available for non-critical consumers and tests.

Renderer monitoring and full authentication UI are also dynamic dependencies. Monitoring initializes after the initial surface, while an early crash loads it through a small local error boundary so failures remain reportable.

## Consequences

- Desktop startup is deterministic offline and no longer inherits Google Fonts availability or latency.
- Adding a language does not grow the ordinary startup payload by the size of its translation catalog.
- System font metrics can differ slightly from Inter on machines without a local Inter installation; this is preferable to a network-dependent desktop shell. Bundled fonts remain an option if exact typography later becomes a measured product requirement.
