import { registeredPreset, setCircuits } from "@crisp-e3/sdk";
import type { CircuitBundle, CircuitPreset } from "@crisp-e3/sdk";

// The BFV-shaped circuits ship as one entry point per preset. Loading them through a dynamic
// import gives the bundler a split point, so the app boots on the SDK's small main entry and only
// downloads a circuit bundle when someone votes.
const LOADERS: Record<CircuitPreset, () => Promise<{ loadCircuits: () => Promise<CircuitBundle> }>> = {
  "insecure-512": () => import("@crisp-e3/sdk/insecure-512"),
  "secure-8192": () => import("@crisp-e3/sdk/secure-8192"),
};

const pending: Partial<Record<CircuitPreset, Promise<void>>> = {};

const presetForParamSet = (paramSet: number): CircuitPreset | null => {
  if (paramSet === 0) return "insecure-512";
  if (paramSet === 1) return "secure-8192";
  return null;
};

/** Install the circuits needed for encrypting and proving, at most once per session. */
export const ensureCircuits = async (paramSet: number): Promise<void> => {
  const expectedPreset = presetForParamSet(paramSet);
  if (!expectedPreset) {
    throw new Error(`Unsupported E3 param set ${paramSet}.`);
  }

  const activePreset = registeredPreset();
  if (activePreset === expectedPreset) {
    return;
  }

  const load = (pending[expectedPreset] ??= (async () => {
    const { loadCircuits } = await LOADERS[expectedPreset]();
    setCircuits(await loadCircuits());
  })());

  try {
    await load;
  } finally {
    // Cache only in-flight loads. A later preset switch must rerun setCircuits().
    if (pending[expectedPreset] === load) {
      delete pending[expectedPreset];
    }
  }

  if (registeredPreset() !== expectedPreset) {
    throw new Error(`The loaded circuit bundle does not match E3 param set ${paramSet}.`);
  }
};
