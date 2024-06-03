# Screenshots and recordings

**Status: not captured.** Producing these needs the apps running on a device or simulator, and the
build machine had no iOS toolchain and no running Android emulator. Rather than ship placeholder
images or mock-ups that could be mistaken for real screens, this file describes exactly what each
asset should show and how to produce it.

That is a limitation, and it is listed as one in the README rather than papered over.

## What belongs here

| File | Shows | How to capture |
|------|-------|----------------|
| `portal-contacts.png` | Trusted contact list with priority order and channel preference | `pnpm dev`, sign in as `demo.user`, Contacts |
| `portal-privacy.png` | Privacy settings, with precise location history off by default | Portal, Privacy |
| `portal-incident-history.png` | Past incidents with status and resolution | Portal, History |
| `console-queue.png` | Operator queue with priority, claim state and age | Sign in as `demo.operator` |
| `console-incident-live.png` | Live incident: map, track, timeline, notes panel | Open an active incident from the queue |
| `console-conflict.png` | Second operator being told who holds the claim | Two browsers, both claim the same incident |
| `contact-view.png` | What a trusted contact sees from their link, on a phone-width viewport | Open a contact link from the MailHog inbox |
| `ios-sos-countdown.png` | Countdown with the cancel affordance | Simulator, hold SOS |
| `ios-active-incident.png` | Active incident with location sharing state | Let the countdown expire |
| `ios-widget.png` | Home-screen widget showing session status | Add the widget in the simulator |
| `android-sos-countdown.png` | Same moment on Android, showing parity | Emulator, hold SOS |
| `android-offline-queue.png` | Queued events while offline, with the pending indicator | Enable airplane mode, trigger SOS |
| `demo-recruiter.mp4` | The two-minute walkthrough from DEMO.md | Screen recording, no audio needed |
| `demo-technical.mp4` | The five-minute technical walkthrough | Screen recording, split view for the two-console demo |

## Capture conventions

- Seeded demo data only. Never a real name, number or place. The fixture generator is constrained to
  reserved ranges precisely because screenshots end up in a portfolio strangers read.
- Both light and dark theme for at least the console and the portal, since both are supported and
  both are contrast-tested.
- Phone-width viewport for the contact view. That is where it will actually be opened.
- The demonstration notice visible in at least one shot per surface.
- PNG for stills, MP4 for recordings, under 2 MB each so the README stays quick to load on a phone.

## Diagrams

Architecture diagrams are Mermaid in the Markdown rather than images. They render on GitHub, they
diff usefully, and they cannot go stale relative to a description sitting next to them.
