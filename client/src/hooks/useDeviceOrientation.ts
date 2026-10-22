import { useEffect, useRef, useState, useCallback } from "react";

export type DeviceOrientationStatus =
  | "idle"
  | "waiting"
  | "tracking"
  | "denied"
  | "unsupported"
  | "no-data";

export type DeviceOrientationSource = "none" | "absolute" | "relative";

export type UseDeviceOrientationOptions = {
  autoStart?: boolean;
};

export function useDeviceOrientation(options: UseDeviceOrientationOptions = {}) {
  const { autoStart = false } = options;
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const [status, setStatus] = useState<DeviceOrientationStatus>(autoStart ? "waiting" : "idle");
  const [headingSource, setHeadingSource] = useState<DeviceOrientationSource>("none");
  const headingSourceRef = useRef<DeviceOrientationSource>("none");
  const cleanupRef = useRef<(() => void) | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    ("DeviceOrientationEvent" in window || "ondeviceorientation" in window);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return () => undefined;
    if (cleanupRef.current) return cleanupRef.current;

    const onDeviceOrientation = (event: DeviceOrientationEvent, absoluteEvent = false) => {
      const compassEvent = event as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
        webkitCompassAccuracy?: number;
      };
      const safariHeading = compassEvent.webkitCompassHeading;
      const hasAbsoluteHeading =
        typeof safariHeading === "number" || absoluteEvent || event.absolute === true;

      if (!hasAbsoluteHeading && headingSourceRef.current === "absolute") return;

      const rawHeading =
        typeof safariHeading === "number"
          ? safariHeading
          : event.alpha == null
            ? null
            : 360 - event.alpha;

      if (rawHeading == null || !Number.isFinite(rawHeading)) return;

      const screenAngle =
        window.screen?.orientation?.angle ??
        (window as Window & { orientation?: number }).orientation ??
        0;

      const correctedHeading = ((rawHeading + screenAngle) % 360 + 360) % 360;
      setDeviceHeading(correctedHeading);

      const nextSource: DeviceOrientationSource = hasAbsoluteHeading ? "absolute" : "relative";
      headingSourceRef.current = nextSource;
      setHeadingSource(nextSource);
      setStatus("tracking");
    };

    const onAbsoluteOrientation = (event: Event) =>
      onDeviceOrientation(event as DeviceOrientationEvent, true);

    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    window.addEventListener("deviceorientationabsolute", onAbsoluteOrientation, true);

    const cleanup = () => {
      window.removeEventListener("deviceorientation", onDeviceOrientation, true);
      window.removeEventListener("deviceorientationabsolute", onAbsoluteOrientation, true);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    return cleanup;
  }, []);

  const stopTracking = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    headingSourceRef.current = "none";
    setHeadingSource("none");
    setDeviceHeading(null);
    setStatus("idle");
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !isSupported) {
      setStatus("unsupported");
      return false;
    }

    const orientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    try {
      if (typeof orientationEvent?.requestPermission === "function") {
        const permission = await orientationEvent.requestPermission();
        if (permission !== "granted") {
          setStatus("denied");
          return false;
        }
      }
      setStatus("waiting");
      startListening();
      return true;
    } catch {
      setStatus("denied");
      return false;
    }
  }, [isSupported, startListening]);

  useEffect(() => {
    if (!autoStart || typeof window === "undefined") return;

    const orientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    } | undefined;

    const requiresExplicitPermission = typeof orientationEvent?.requestPermission === "function";

    if (!requiresExplicitPermission) {
      const cleanup = startListening();
      return () => {
        cleanup();
      };
    }
  }, [autoStart, startListening]);

  useEffect(() => {
    if (status !== "waiting") return;
    const timeoutId = window.setTimeout(() => {
      setStatus((current) => (current === "waiting" ? "no-data" : current));
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [status]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return {
    deviceHeading,
    status,
    headingSource,
    isSupported,
    requestPermission,
    stopTracking,
  };
}
