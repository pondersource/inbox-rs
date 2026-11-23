# Experimental all-backend storage distribution

Inbox RS vendors the `preview.5` Ponder Source core/widget archives. The core
includes Solid, LWS, OneDrive and NextGraph alongside remoteStorage, Dropbox and
Google Drive; the widget uses native connection flows, including AtomicServer's
remoteStorage discovery and consent. Each archive retains its source, license
notices and `storage-preview.json` provenance. The app keeps its upstream data
module and source links.

| Package | Fork source commit | Browser bundle SHA-256 |
| --- | --- | --- |
| Core `2.0.0-beta.10-pondersource.7-preview.5` | [`d295cef9e41e1a3f0d3ff4dd784ba8599d77b787`](https://github.com/pondersource/remotestorage.js/commit/d295cef9e41e1a3f0d3ff4dd784ba8599d77b787) | `f4d2fb86d353d225ad5855638647961be1bd529563fa36ea1b1c14c138821746` |
| Widget `1.8.2-pondersource.2-preview.5` | [`045c78cd752593e58fffed7386ddcbb4ba74dd2e`](https://github.com/pondersource/remotestorage-widget/commit/045c78cd752593e58fffed7386ddcbb4ba74dd2e) | `7a070705f828684e16de500610ed8874c1c8943e8416e87babb7b6a810340bb6` |

The core bundle is 1,072,397 bytes; the widget is 112,300 bytes.
[The companion manifest](storage-preview.json) records archive hashes, exact
source digests and bundle sizes. npm lockfile integrity verifies the vendored
archives. GitHub Pages builds the app from this repository's `main`; this
vendoring does not publish a package to the npm registry.

The authenticated LWS callback fixes come from the pinned core source above.
Experimental provider acceptance remains separate from app build and offline
checks: real OneDrive, production LWS identity providers, Atomic consent and
NextGraph broker synchronization still require their documented validation.
OneDrive uses the public Ponder Source personal-account SPA registration, whose
production callback must include this app's origin.

The app retains its 2.25 MiB precache budget and caches the storage shell. The
separate guest-to-NextGraph first-import limitation is unchanged: the shared
export covers remoteStorage's cache, while other browser stores need their own
migration adapters.
