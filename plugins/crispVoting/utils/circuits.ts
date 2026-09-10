import { registeredPreset, setCircuits } from "@crisp-e3/sdk";
import type { CircuitBundle, CircuitPreset } from "@crisp-e3/sdk";
import type { ThresholdBfvParamsPresetName } from "@interfold/sdk";

// The BFV-shaped circuits ship as their own entry point per preset (~3MB), separate from the
// SDK's main entry. Loading them through a dynamic import gives the bundler a split point, so
// the app only pays for them when someone actually votes.
//
// Which preset to load is decided by the ROUND, not by this file. `resolvePresetForParams`
// already identifies a round's parameter set by comparing `Interfold.paramSetRegistry(paramSet)`
// against every preset the SDK knows — the same answer the committee-key check is trusted with.
// Hardcoding a preset here would reintroduce exactly the assumption that check refuses to make:
// the numeric `paramSet` is a registry key, and nothing stops a deployment registering different
// parameters under it. It also means enabling secure parameters on chain needs no change here.
const LOADERS: Record<CircuitPreset, () => Promise<{ loadCircuits: () => Promise<CircuitBundle> }>> = {
  "insecure-512": () => import("@crisp-e3/sdk/insecure-512"),
  "secure-8192": () => import("@crisp-e3/sdk/secure-8192"),
};

/// The two SDKs name the same parameter sets differently: `@interfold/sdk` resolves a round to a
/// `ThresholdBfvParamsPresetName`, while `@crisp-e3/sdk` keys its circuit bundles by
/// `CircuitPreset`. Mapping is total in both directions today; an unmapped name is a new preset
/// this app has no circuits for, which must refuse rather than silently fall back to 512-degree
/// circuits and produce proofs the verifier rejects.
const CIRCUIT_PRESET_FOR: Record<ThresholdBfvParamsPresetName, CircuitPreset> = {
  INSECURE_THRESHOLD_512: "insecure-512",
  SECURE_THRESHOLD_8192: "secure-8192",
};

const pending: Partial<Record<CircuitPreset, Promise<void>>> = {};

/**
 * Installs the circuits a round needs, at most once per preset per session.
 *
 * @param presetName The round's parameter set, from `resolvePresetForParams`.
 */
export const ensureCircuits = async (presetName: ThresholdBfvParamsPresetName): Promise<void> => {
  const preset = CIRCUIT_PRESET_FOR[presetName];
  if (!preset) {
    throw new Error(`This round uses parameter set ${presetName}, which this app has no circuits for.`);
  }

  // Registering a second preset over a live one would leave the SDK proving against circuits that
  // do not match the ciphertext, so a mismatch is refused rather than swapped underneath.
  const active = registeredPreset();
  if (active === preset) return;
  if (active) {
    throw new Error(
      `Circuits for ${active} are already loaded; this round needs ${preset}. Reload the page before voting on it.`
    );
  }

  pending[preset] ??= (async () => {
    try {
      const { loadCircuits } = await LOADERS[preset]();
      setCircuits(await loadCircuits());
    } catch (error) {
      // Let the next attempt retry rather than caching a failed fetch for the session.
      pending[preset] = undefined;
      throw error;
    }
  })();

  await pending[preset];
};
