/**
 * Lazurio overlay: LazurioPlatform F50 point 2 (`viewAddressOf`, `isViewHost`) as a table of
 * addresses and what each is, for the tests of the server's Environment browser host and of the
 * web's panel. apps/server and apps/web hold this same file; the release contract test keeps it so.
 */

/** A remote tab of this Environment's browser, written as Chromium writes it. */
export const personTab = "B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2";
/** A remote tab of another Environment's browser. */
export const foreignId = "0123456789ABCDEF0123456789ABCDEF";
export const foreignView = `https://browser.vm-02.acme.lazurio.io/t/${foreignId}`;

// LazurioPlatform F50 point 2 (`viewAddressOf`, `isViewHost`), case by case: a view address is
// taken only as written, its own bare origin a new tab, `/t/<id>` its tab or another Environment's.
// Any other address on a view host is refused, as written or as `normalizePreviewUrl` makes it,
// before this browser loads it; an address on any other host loads.
export const ownHost = "browser.vm-01.acme.lazurio.io";
const foreignHost = "browser.vm-02.acme.lazurio.io";
export type Takes =
  | "new tab"
  | "own tab"
  | { readonly foreign: string }
  | { readonly refused: string }
  /** `normalizePreviewUrl` reads no URL in it, so nothing is opened or loaded. */
  | "invalid"
  /** What this browser loads. */
  | { readonly loads: string };

/** Each address on the view host `host` that F50 point 2 does not take, around the tab `id`. */
const offContract = (host: string, id: string): ReadonlyArray<string> => [
  // The host as written: its trailing dot, upper case, or a scheme in upper case.
  `https://${host}./t/${id}`,
  `https://${host}../t/${id}`,
  `https://${host}%2e/t/${id}`,
  `https://${host}\u3002/t/${id}`,
  `https://${host.toUpperCase()}/t/${id}`,
  `https://${host.replace("browser", "BROWSER")}/t/${id}`,
  `HTTPS://${host}/t/${id}`,
  // A port, even the default one, or another scheme.
  `https://${host}:443/t/${id}`,
  `https://${host}:8443/t/${id}`,
  `https://${host}:/t/${id}`,
  `http://${host}/t/${id}`,
  // What only `new URL` or `normalizePreviewUrl` makes a view address of.
  `https:/${host}/t/${id}`,
  `//${host}/t/${id}`,
  `${host}/t/${id}`,
  ` https://${host}/t/${id} `,
  `https://${host}/t/${id}\n`,
  `https://${host}\\t\\${id}`,
  `https:\\\\${host}\\t\\${id}`,
  `ht\ttps://${host}/t/${id}`,
  `\u00a0https://${host}/t/${id}`,
  // Another path.
  `https://${host}/x/../t/${id}`,
  `https://${host}/t/./${id}`,
  `https://${host}//t/${id}`,
  `https://${host}/t/${id}/`,
  `https://${host}/t/${id}/live`,
  `https://${host}/t/`,
  `https://${host}/t`,
  `https://${host}/x`,
  `https://${host}/T/${id}`,
  `https://${host}/%74/${id}`,
  // A query, a fragment or credentials, even empty ones.
  `https://${host}/t/${id}?source=agent`,
  `https://${host}/t/${id}?`,
  `https://${host}/t/${id}#view`,
  `https://${host}/t/${id}#`,
  `https://user@${host}/t/${id}`,
  `https://user:pw@${host}/t/${id}`,
  `https://@${host}/t/${id}`,
  // No target id: 31 or 33 digits, not hexadecimal, or percent-encoded.
  `https://${host}/t/${id.slice(1)}`,
  `https://${host}/t/${id}0`,
  `https://${host}/t/${"G".repeat(32)}`,
  `https://${host}/t/%41${id.slice(1)}`,
  // The bare origin in any form but the two.
  `https://${host}/?`,
  `https://${host}/?source=agent`,
  `https://${host}#`,
  `https://${host}/#`,
  `https://${host}:443`,
  `https://${host}:443/`,
  `https://${host}:/`,
  `https://:@${host}/`,
  `\ufeffhttps://${host}/`,
  `https://${host}./`,
  `https://${host}/./`,
  `https://${host}//`,
  `https://${host.toUpperCase()}/`,
  `https://${host.replace("browser", "BROWSER")}/`,
  ` https://${host}/`,
  host,
];
const mixedCase = (id: string) =>
  [...id].map((digit, index) => (index % 2 === 0 ? digit.toLowerCase() : digit)).join("");
const personalHost = "browser.example-person.lazurio.io";
const personalView = `https://${personalHost}/t/${foreignId}`;
const longLabel = "a".repeat(63);
export const contractCases: ReadonlyArray<{ readonly address: string; readonly takes: Takes }> = [
  { address: `https://${ownHost}`, takes: "new tab" },
  { address: `https://${ownHost}/`, takes: "new tab" },
  { address: `https://${ownHost}/t/${personTab}`, takes: "own tab" },
  { address: `https://${ownHost}/t/${personTab.toLowerCase()}`, takes: "own tab" },
  { address: `https://${ownHost}/t/${mixedCase(personTab)}`, takes: "own tab" },
  { address: foreignView, takes: { foreign: foreignView } },
  {
    address: `https://${foreignHost}/t/${foreignId.toLowerCase()}`,
    takes: { foreign: foreignView },
  },
  { address: `https://${foreignHost}/t/${mixedCase(foreignId)}`, takes: { foreign: foreignView } },
  { address: personalView, takes: { foreign: personalView } },
  {
    address: `https://browser.${longLabel}.a-1.lazurio.io/t/${foreignId}`,
    takes: { foreign: `https://browser.${longLabel}.a-1.lazurio.io/t/${foreignId}` },
  },
  ...offContract(ownHost, personTab).map((address) => ({ address, takes: { refused: ownHost } })),
  ...offContract(foreignHost, foreignId).map((address) => ({
    address,
    takes: { refused: foreignHost },
  })),
  ...offContract(personalHost, foreignId).map((address) => ({
    address,
    takes: { refused: personalHost },
  })),
  // Another Environment's bare origin is a new tab of its browser, which this host does not open.
  { address: `https://${foreignHost}`, takes: { refused: foreignHost } },
  { address: `https://${foreignHost}/`, takes: { refused: foreignHost } },
  // A base that is no Environment id: three labels, none, or a label that is no DNS label.
  ...[
    "browser.a.vm-02.acme.lazurio.io",
    "browser.lazurio.io",
    "browser.-vm-02.acme.lazurio.io",
    "browser.vm-02-.acme.lazurio.io",
    `browser.${"a".repeat(64)}.acme.lazurio.io`,
    "browser.vm_02.acme.lazurio.io",
  ].map((host) => ({ address: `https://${host}/t/${foreignId}`, takes: { refused: host } })),
  // A label is written as the host is: an internationalized name only in its ASCII form.
  {
    address: `https://browser.vm-02.xn--cme-dla.lazurio.io/t/${foreignId}`,
    takes: { foreign: `https://browser.vm-02.xn--cme-dla.lazurio.io/t/${foreignId}` },
  },
  {
    address: `https://browser.vm-02.ácme.lazurio.io/t/${foreignId}`,
    takes: { refused: "browser.vm-02.xn--cme-dla.lazurio.io" },
  },
  { address: `https:${ownHost}/t/${personTab}`, takes: "invalid" },
  ...[`wss://${ownHost}/t/${personTab}`, `view-source:https://${ownHost}/t/${personTab}`].map(
    (address) => ({ address, takes: "invalid" as const }),
  ),
  // Any other host loads, a Lazurio app or a look-alike of a view host.
  ...[
    "https://xbrowser.vm-01.acme.lazurio.io/",
    `https://t3code.vm-01.acme.lazurio.io/t/${personTab}`,
    `https://browser.vm-01.acme.lazurio.io.example.test/t/${personTab}`,
    "https://browser.example.test/",
    `https://${ownHost}@example.test/`,
  ].map((address) => ({ address, takes: { loads: address } })),
  { address: "example.test/t/x", takes: { loads: "https://example.test/t/x" } },
];
