import { normalizeHttpBaseUrl } from "@t3tools/shared/advertisedEndpoint";
export * from "@t3tools/shared/advertisedEndpoint";

export const environmentEndpointUrl = (httpBaseUrl: string, pathname: string): string => {
  const url = new URL(normalizeHttpBaseUrl(httpBaseUrl));
  url.pathname += pathname.replace(/^\/+/, "");
  return url.toString();
};

export const environmentSocketUrl = (wsBaseUrl: string): URL => {
  const url = new URL(wsBaseUrl);
  if (!url.pathname.endsWith("/ws")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  }
  return url;
};
