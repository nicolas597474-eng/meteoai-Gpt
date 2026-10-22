import { useEffect, useRef, useState } from "react";
import { createSolarWebGLRenderer, SOLAR_TEXTURE_URL, type SolarWebGLRenderer } from "@/lib/solarWebgl";

type Props = { size: "header" | "marker" };
type RenderMode = "loading" | "webgl-3d" | "2d-fallback";
type FallbackReason = "reduced-motion" | "webgl-unavailable" | "texture-unavailable";

const FACE_DESCRIPTION = "Image fixe du disque solaire HMI observé le 23 août 2011 à 04:00 UTC. Seule cette face observée est représentée; l’arrière non observé, une texture globale et la couronne ne le sont pas.";

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

function getFallbackLabel(reason: FallbackReason | null) {
  if (reason === "reduced-motion") return "préférence de réduction des mouvements";
  if (reason === "texture-unavailable") return "image HMI indisponible";
  if (reason === "webgl-unavailable") return "WebGL indisponible";
  return "chargement du rendu WebGL";
}

export function SolarGlobe({ size }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const rendererRef = useRef<SolarWebGLRenderer | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [textureReady, setTextureReady] = useState(false);
  const [textureFailed, setTextureFailed] = useState(false);
  const [mode, setMode] = useState<RenderMode>("loading");
  const [fallbackReason, setFallbackReason] = useState<FallbackReason | null>(null);
  const reducedMotion = useReducedMotion();

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
    if (textureFailed) {
      setMode("2d-fallback");
      setFallbackReason("texture-unavailable");
      return;
    }
    if (!nearViewport || !textureReady) return;

    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    let cancelled = false;
    let renderer: SolarWebGLRenderer | null = null;
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
    renderer = createSolarWebGLRenderer(canvas, image);
    if (!renderer) {
      setMode("2d-fallback");
      setFallbackReason("webgl-unavailable");
    } else if (!cancelled) {
      rendererRef.current = renderer;
      setMode("webgl-3d");
    }

    return () => {
      cancelled = true;
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      renderer?.dispose();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [nearViewport, reducedMotion, textureReady, textureFailed]);

  const diameter = size === "header" ? "h-8 w-8" : "h-12 w-12";
  const label = mode === "webgl-3d"
    ? `${FACE_DESCRIPTION} Rendu en géométrie sphérique 3D WebGL, face fixe sans rotation.`
    : `${FACE_DESCRIPTION} Représentation 2D : ${getFallbackLabel(fallbackReason)}.`;

  return <span
    ref={containerRef}
    role="img"
    aria-label={label}
    className={`solar-hmi-globe relative grid ${diameter} shrink-0 place-items-center`}
    data-render-mode={mode}
    data-solar-size={size}
  >
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 block h-full w-full ${mode === "webgl-3d" ? "opacity-100" : "opacity-0"}`}
      width={1}
      height={1}
    />
    {nearViewport && <img
      ref={imageRef}
      src={SOLAR_TEXTURE_URL}
      alt=""
      aria-hidden="true"
      draggable={false}
      loading="lazy"
      decoding="async"
      onLoad={() => setTextureReady(true)}
      onError={() => setTextureFailed(true)}
      className={`absolute inset-0 block h-full w-full object-contain ${mode !== "webgl-3d" && textureReady ? "opacity-100" : "opacity-0"}`}
    />}
    {mode !== "webgl-3d" && !textureReady && <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 block h-full w-full">
      <circle cx="50" cy="50" r="46" fill="#f97316" />
    </svg>}
    {mode !== "webgl-3d" && <span aria-hidden="true" className="absolute bottom-0 right-0 z-10 rounded-full bg-slate-950/95 px-[3px] text-[7px] font-bold leading-[10px] text-slate-50 ring-1 ring-white/40">2D</span>}
  </span>;
}
