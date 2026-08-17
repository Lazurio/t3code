import { WEB_DISTRIBUTION_NAME } from "../branding";

export function SplashScreen() {
  const appName = WEB_DISTRIBUTION_NAME ?? "T3 Code";
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`${appName} splash screen`}
      >
        <img alt={appName} className="size-16 object-contain" src="/apple-touch-icon.png" />
      </div>
    </div>
  );
}
