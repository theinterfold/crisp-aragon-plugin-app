import { registeredPreset, setCircuits } from "@crisp-e3/sdk";

// The BFV-shaped circuits ship as their own entry point per preset (~3MB), separate from the
// SDK's main entry. Loading them through a dynamic import gives the bundler a split point, so
// the app only pays for them when someone actually votes.
//
// This app votes in insecure-512 rounds for now. Switching to the production preset is a
// change here and nowhere else: import "@crisp-e3/sdk/secure-8192" instead.
let pending: Promise<void> | null = null;

/** Install the circuits needed for encrypting and proving, at most once per session. */
export const ensureCircuits = async (): Promise<void> => {
  if (registeredPreset()) return;

  pending ??= (async () => {
    try {
      const { loadCircuits } = await import("@crisp-e3/sdk/insecure-512");
      setCircuits(await loadCircuits());
    } catch (error) {
      // Let the next attempt retry rather than caching a failed fetch for the session.
      pending = null;
      throw error;
    }
  })();

  await pending;
};
