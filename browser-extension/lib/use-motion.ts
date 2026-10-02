import { useSyncExternalStore } from "react";
import { getMotion, subscribeMotion } from "./motion-preference";

export const useMotion = () => useSyncExternalStore(subscribeMotion, getMotion);
