import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  createSnowParticles,
  createSnowVisualState,
  getSnowParticleCount,
  updateSnowParticles,
  writeSnowVertices,
  type SnowVisualCategory,
} from "@/lib/weatherReality/snowVisualEngine";
import { createSnowWebGLRenderer } from "@/lib/weatherReality/snowWebGLRenderer";
import type { WeatherEffectsMode } from "@/lib/weatherReality/rainVisualEngine";

type SnowRendererMode = "css" | "webgl";

type Props = {
  effectsMode: WeatherEffectsMode;
  category: SnowVisualCategory;
  windSpeedKmh?: number | null;
  windDirectionDegrees?: number | null;
  onRendererChange: (mode: SnowRendererMode) => void;
};

function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reducedMotion;
}

export function SnowWebGLCanvas({
  effectsMode,
  category,
  windSpeedKmh,
  windDirectionDegrees,
  onRendererChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotionPreference();
  const state = createSnowVisualState({
    isSnowCategory: true,
    category,
    windSpeedKmh,
    windDirectionDegrees,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onRendererChange("css");
    if (reducedMotion || effectsMode === "off" || !state.isSnowCategory) return;

    const renderer = createSnowWebGLRenderer(canvas);
    if (!renderer) return;

    let running = true;
    let pageVisible = document.visibilityState !== "hidden";
    let inViewport = true;
    let frameId: number | null = null;
    let lastFrameTime = 0;
    let lastDrawTime = 0;
    let elapsedSeconds = 0;
    let viewportWidth = 0;
    let viewportHeight = 0;
    let particles = createSnowParticles(0, state.category);
    let vertices = new Float32Array(0);

    const stopLoop = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      lastFrameTime = 0;
    };

    const schedule = () => {
      if (running && pageVisible && inViewport && frameId === null) {
        frameId = window.requestAnimationFrame(drawFrame);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      viewportWidth = bounds.width;
      viewportHeight = bounds.height;
      renderer.resize(
        viewportWidth,
        viewportHeight,
        window.devicePixelRatio || 1
      );
      const count = getSnowParticleCount(state, effectsMode, viewportWidth);
      if (count !== particles.length) {
        particles = createSnowParticles(count, state.category);
        vertices = new Float32Array(count * 5);
      }
      schedule();
    };

    const drawFrame = (time: number) => {
      frameId = null;
      if (
        !running ||
        !pageVisible ||
        !inViewport ||
        !viewportWidth ||
        !viewportHeight
      )
        return;
      const compactViewport = viewportWidth < 600;
      const frameInterval =
        1000 / (effectsMode === "reduced" ? 30 : compactViewport ? 45 : 60);
      if (time - lastDrawTime >= frameInterval) {
        const deltaSeconds =
          lastFrameTime === 0 ? 1 / 60 : (time - lastFrameTime) / 1000;
        elapsedSeconds += Math.min(0.05, Math.max(0, deltaSeconds));
        updateSnowParticles(particles, deltaSeconds, elapsedSeconds, state);
        writeSnowVertices(particles, vertices);
        renderer.draw(vertices);
        lastFrameTime = time;
        lastDrawTime = time;
      }
      schedule();
    };

    const onVisibilityChange = () => {
      pageVisible = document.visibilityState !== "hidden";
      if (pageVisible) schedule();
      else stopLoop();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      stopLoop();
      onRendererChange("css");
      renderer.dispose();
    };

    resize();
    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("resize", resize, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(canvas);
    const intersectionObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(entries => {
            inViewport = entries.some(
              entry => entry.isIntersecting && entry.intersectionRatio > 0
            );
            if (inViewport) schedule();
            else stopLoop();
          });
    intersectionObserver?.observe(canvas);

    onRendererChange("webgl");
    schedule();

    return () => {
      running = false;
      stopLoop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("resize", resize);
      renderer.dispose();
    };
  }, [
    effectsMode,
    category,
    windSpeedKmh,
    windDirectionDegrees,
    reducedMotion,
    onRendererChange,
    state.isSnowCategory,
    state.category,
    state.windSpeedKmh,
    state.windDirectionDegrees,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="dashboard-weather-atmosphere__snow-canvas"
      width={1}
      height={1}
      data-snow-canvas="webgl"
    />
  );
}
