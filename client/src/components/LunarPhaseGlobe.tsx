import { useEffect, useRef, useState } from "react";
import { getLunarShadowPath, getLunarShadowTransform, clampLunarIllumination } from "@/lib/lunarPhaseVisual";
import {
  createLunarWebGLRenderer,
  LUNAR_TEXTURE_URL,
  type LunarPhaseVisual,
  type LunarWebGLRenderer,
} from "@/lib/lunarWebgl";

type Props = {
  phase: LunarPhaseVisual;
  size: "marker" | "detail";
  alt: string;
};

type RenderMode = "loading" | "webgl-3d" | "2d-fallback";
type FallbackReason = "reduced-motion" | "webgl-unavailable" | "texture-unavailable";

let textureImagePromise: Promise<HTMLImageElement> | null = null;

function loadTextureImage() {
  if (!textureImagePromise) {
    textureImagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => {
        textureImagePromise = null;
        reject(new Error("Texture lunaire indisponible."));
      };
      image.src = LUNAR_TEXTURE_URL;
    });
  }
  return textureImagePromise;
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reducedMotion;
}

function LunarPhaseFallback({ phase, reason, size }: { phase: LunarPhaseVisual; reason: FallbackReason | null; size: Props["size"] }) {
  const illumination = clampLunarIllumination(phase.illuminationPct);
  const shadowPath = getLunarShadowPath(illumination);
  const shadowTransform = getLunarShadowTransform(phase.brightLimbAngleDeg);
  const reasonLabel = reason === "reduced-motion"
    ? "préférence de réduction des mouvements"
    : reason === "texture-unavailable"
      ? "texture WebGL indisponible"
      : reason === "webgl-unavailable"
        ? "WebGL indisponible"
        : "chargement du rendu WebGL";
  const detail = size === "detail";

  return <>
    <svg aria-hidden="true" viewBox="0 0 100 100" className="block h-full w-full">
      <circle cx="50" cy="50" r="49" fill="#b8bbc1" />
      {shadowPath && <path d={shadowPath} transform={shadowTransform} fill="#111827" />}
    </svg>
    <span aria-hidden="true" className="absolute bottom-0 right-0 rounded-full bg-slate-950/90 px-1 py-px text-[7px] font-semibold leading-tight text-slate-100">2D</span>
    {detail && <span aria-hidden="true" className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[7px] leading-none text-slate-400">2D · {reasonLabel}</span>}
  </>;
}

export function LunarPhaseGlobe({ phase, size, alt }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LunarWebGLRenderer | null>(null);
  const latestPhaseRef = useRef(phase);
  const [nearViewport, setNearViewport] = useState(false);
  const [mode, setMode] = useState<RenderMode>("loading");
  const [fallbackReason, setFallbackReason] = useState<FallbackReason | null>(null);
  const reducedMotion = useReducedMotion();
  latestPhaseRef.current = phase;

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setMode("2d-fallback");
      setFallbackReason("reduced-motion");
      return;
    }
    if (!nearViewport) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderer: LunarWebGLRenderer | null = null;
    setMode("loading");
    setFallbackReason(null);

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      renderer?.dispose();
      renderer = null;
      rendererRef.current = null;
      setMode("2d-fallback");
      setFallbackReason("webgl-unavailable");
    };
    canvas.addEventListener("webglcontextlost", handleContextLost);

    loadTextureImage()
      .then((image) => {
        if (cancelled) return;
        renderer = createLunarWebGLRenderer(canvas, image, latestPhaseRef.current);
        if (!renderer) {
          setMode("2d-fallback");
          setFallbackReason("webgl-unavailable");
          return;
        }
        rendererRef.current = renderer;
        setMode("webgl-3d");
      })
      .catch(() => {
        if (!cancelled) {
          setMode("2d-fallback");
          setFallbackReason("texture-unavailable");
        }
      });

    return () => {
      cancelled = true;
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      renderer?.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [nearViewport, reducedMotion]);

  useEffect(() => {
    rendererRef.current?.render(phase);
  }, [phase.angleDeg, phase.illuminationPct, phase.illuminationFraction, phase.brightLimbAngleDeg, phase.librationLongitudeDeg, phase.librationLatitudeDeg, phase.lunarNorthPoleAngleDeg]);

  const diameter = size === "marker" ? "h-10 w-10" : "h-16 w-16";
  const illumination = clampLunarIllumination(phase.illuminationPct);
  const label = mode === "webgl-3d"
    ? `${alt}, éclairage ${illumination} %, rendu 3D WebGL.`
    : mode === "2d-fallback"
      ? `${alt}, éclairage ${illumination} %, représentation 2D : ${fallbackReason === "reduced-motion" ? "préférence de réduction des mouvements" : fallbackReason === "texture-unavailable" ? "texture WebGL indisponible" : "WebGL indisponible"}.`
      : `${alt}, éclairage ${illumination} %, représentation 2D pendant le chargement WebGL.`;

  return <span
    ref={containerRef}
    role="img"
    aria-label={label}
    className={`relative grid ${diameter} shrink-0 place-items-center`}
    data-phase-label={phase.label}
    data-illumination-pct={illumination}
    data-bright-limb-angle-deg={phase.brightLimbAngleDeg}
    data-waxing={phase.waxing}
    data-render-mode={mode}
  >
    <canvas ref={canvasRef} aria-hidden="true" className={`absolute inset-0 block h-full w-full transition-opacity ${mode === "webgl-3d" ? "opacity-100" : "opacity-0"}`} width={1} height={1} />
    {mode !== "webgl-3d" && <LunarPhaseFallback phase={phase} reason={fallbackReason} size={size} />}
  </span>;
}
