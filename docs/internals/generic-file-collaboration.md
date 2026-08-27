# Generic file collaboration

The hosted browser application carries arbitrary user files in an additive `contextFiles` lane.
`ChatAttachment` remains an image-only union so official vanilla Desktop and Mobile binaries never
decode an unknown attachment member. Every new field is optional on the wire; stable v0.0.35
decoders silently drop it and continue to render the text summary persisted with the user message.

## Upload and persistence

The existing authenticated attachment-mint RPC issues a signed upload URL. Missing `type` keeps the
legacy image behavior; `type: "file"` selects generic files. The HTTP route streams request chunks to
a random `.part` path, stops as soon as the signed size is exceeded, verifies the exact byte count,
and atomically renames a successful upload to opaque `.bin` storage. A generic file is limited to
25 MiB, a turn to eight generic files, and a turn containing generic files to 50 MiB across files
and images. Image-only turns retain the vanilla per-image limits without the new aggregate ceiling.

At turn start the normalizer claims the pending upload into the thread-owned attachment namespace.
Metadata is stored in the ordered message projection's separate `context_files_json` column and in
the event payload. Projection rebuild, snapshot reads, reducer updates, revert, and attachment GC all
use the same message ownership boundary.

The browser retains the source `File` object only in the in-memory composer draft. The persisted
draft serializer enumerates allowed fields and cannot write generic-file metadata or bytes to
localStorage. Failed sends restore the in-memory snapshot for retry; a page reload intentionally
drops unsent generic files.

## Provider delivery

Immediately before dispatch, the server resolves the opaque attachment id, verifies a regular file
with the recorded size, and adds its absolute path to provider input. The provider prompt describes
the name, MIME type, size, and verified path and tells the agent to inspect the file with an
appropriate workspace tool before claiming to understand it. Provider-native document blocks can
be added later without changing the persisted contract.

## Download authority

Uploaded-file download minting resolves the exact thread, message, and attachment id from the live
projection before signing. The claim pins the opaque id, filename, and size; every HTTP request
rechecks type and size. Agent-created workspace links mint an exact-file claim after canonical
realpath containment. Generic downloads always use `Content-Disposition: attachment`,
`application/octet-stream`, `nosniff`, and `private, no-store`; preview directory capabilities are
never reused.

Workspace downloads intentionally follow the existing authenticated workspace-read authority,
including dotfiles. The UI never downloads a file automatically: a user must select the explicit
download action.

## Upstream and migration lifecycle

Fork migration id 44 is recorded as `LazurioProjectionThreadMessagesContextFiles`, a temporary
lease that CI requires to remain the last migration. The exact reconciliation procedure for the
first future upstream stable that owns id 44 or greater lives in the
[Lazurio fork release contract](../operations/lazurio-fork-release.md#context-file-migration-lease).

When upstream stable provides equivalent generic-file support, adopt its contract rather than
maintaining a parallel protocol. Reconcile persisted metadata, remove the fork lane that upstream
supersedes, rerun the pinned prior-vanilla decoder fixtures, and repeat browser plus official
Desktop/Mobile acceptance before rollout.
