"use client";

/**
 * Measurement overlay — a 2D canvas that sits on top of the Molstar 3D viewer
 * and draws spheres/lines/labels for click-to-measure interactions.
 *
 * This replicates the behavior of the upload project's 3Dmol.js-based
 * measurement (which used `viewer.addCylinder`, `viewer.addSphere`,
 * `viewer.addLabel`). Molstar doesn't expose an equivalent imperative API,
 * so we project 3D atom coords → 2D screen coords ourselves using the
 * Molstar camera's `projectionView` matrix and draw on a transparent canvas.
 *
 * The overlay has `pointer-events: none` so clicks pass through to Molstar.
 */

import { useEffect, useRef } from "react";
import { useAppStore } from "@/lib/store";

interface MeasureAtom {
  x: number;
  y: number;
  z: number;
  label: string;
}

interface MeasureItem {
  id: string;
  mode: "distance" | "angle";
  label: string;
  detail: string;
  atoms: MeasureAtom[];
}

interface PendingAtom {
  x: number;
  y: number;
  z: number;
  label: string;
}

/**
 * Project a 3D world-space point to 2D screen-space pixel coords.
 * Returns {x, y, visible} where visible=false means the point is behind
 * the camera or outside the viewport.
 */
function project3DTo2D(
  point: [number, number, number],
  projectionView: number[] | Float32Array | Float64Array,
  viewport: { width: number; height: number }
): { x: number; y: number; visible: boolean } {
  const [px, py, pz] = point;
  // Apply the 4x4 projectionView matrix.
  // result = PV * [px, py, pz, 1]
  const rx =
    projectionView[0] * px +
    projectionView[4] * py +
    projectionView[8] * pz +
    projectionView[12];
  const ry =
    projectionView[1] * px +
    projectionView[5] * py +
    projectionView[9] * pz +
    projectionView[13];
  const rz =
    projectionView[2] * px +
    projectionView[6] * py +
    projectionView[10] * pz +
    projectionView[14];
  const rw =
    projectionView[3] * px +
    projectionView[7] * py +
    projectionView[11] * pz +
    projectionView[15];

  // Point is behind the camera.
  if (rw <= 0) return { x: 0, y: 0, visible: false };

  // Perspective divide → Normalized Device Coords [-1, 1].
  const ndcX = rx / rw;
  const ndcY = ry / rw;

  // Convert NDC to screen pixels.
  // NDC x: -1 = left, +1 = right → screen x = (ndcX + 1) * 0.5 * width
  // NDC y: -1 = bottom, +1 = top → screen y = (1 - ndcY) * 0.5 * height
  const screenX = (ndcX + 1) * 0.5 * viewport.width;
  const screenY = (1 - ndcY) * 0.5 * viewport.height;

  return { x: screenX, y: screenY, visible: true };
}

/**
 * Draw a sphere (circle with radial gradient) at a 2D position.
 */
function drawSphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string
) {
  // Outer glow.
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.8);
  glow.addColorStop(0, color);
  glow.addColorStop(0.5, color + "80");
  glow.addColorStop(1, color + "00");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Solid sphere.
  const grad = ctx.createRadialGradient(
    x - radius * 0.3,
    y - radius * 0.3,
    0,
    x,
    y,
    radius
  );
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.3, color);
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Outline.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Draw a line between two 2D points.
 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  dashed = false
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  if (dashed) {
    ctx.setLineDash([6, 4]);
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a label (text with background) at a 2D position.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bgColor: string,
  textColor: string = "#ffffff"
) {
  ctx.save();
  ctx.font = "bold 13px ui-monospace, monospace";
  const metrics = ctx.measureText(text);
  const padding = 4;
  const w = metrics.width + padding * 2;
  const h = 18;

  // Background.
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
  ctx.fill();

  // Border.
  ctx.strokeStyle = bgColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text.
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Hook to read measurement state from the store, re-rendering on changes. */
function useMeasureState() {
  const measureMode = useAppStore((s) => s.measureMode);
  const measurements = useAppStore((s) => s.measurements);
  const interactionLines = useAppStore((s) => s.interactionLines);
  const viewer = useAppStore((s) => s.viewer);
  return { measureMode, measurements, interactionLines, viewer };
}

/** Pending atoms are stored in a ref on the MeasureToolbar, but we also need
 *  them here. We use a simple shared module-level state that the toolbar
 *  writes to and the overlay reads from. */
const pendingState: { atoms: PendingAtom[]; version: number } = {
  atoms: [],
  version: 0,
};

export function setPendingAtoms(atoms: PendingAtom[]) {
  pendingState.atoms = atoms;
  pendingState.version++;
}

export function getPendingVersion() {
  return pendingState.version;
}

export function MeasureOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { measureMode, measurements, interactionLines, viewer } = useMeasureState();
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Resize canvas to match its display size.
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(rect.width * dpr) ||
        canvas.height !== Math.round(rect.height * dpr)
      ) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Need the plugin's camera.
      const plugin = (window as any).__molstarPlugin;
      if (!plugin?.canvas3d?.camera) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      const camera = plugin.canvas3d.camera;
      const pv = camera.projectionView;
      const vp = camera.viewport;
      if (!pv || !vp) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const viewport = { width: vp.width, height: vp.height };

      // Draw completed measurements.
      // NOTE: the current store's `measurements` entries only carry
      // {id, mode, label, detail, ts} — they do NOT include atom coords
      // (Molstar's native measurement manager draws those in 3D). So we
      // skip the overlay rendering for measurements and only draw the
      // `interactionLines` below, which DO carry explicit 3D coords.
      for (const m of measurements as MeasureItem[]) {
        const atoms = (m as unknown as { atoms?: MeasureAtom[] }).atoms;
        if (!atoms || atoms.length === 0) continue;
        const projected = atoms.map((a) =>
          project3DTo2D([a.x, a.y, a.z], pv, viewport)
        );

        if (m.mode === "distance" && projected.length === 2) {
          const [p1, p2] = projected;
          if (p1.visible && p2.visible) {
            // Line.
            drawLine(
              ctx,
              p1.x,
              p1.y,
              p2.x,
              p2.y,
              "#f59e0b",
              3,
              false
            );
            // Spheres at endpoints.
            drawSphere(ctx, p1.x, p1.y, 6, "#ef4444");
            drawSphere(ctx, p2.x, p2.y, 6, "#ef4444");
            // Label at midpoint.
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            drawLabel(ctx, m.label, midX, midY, "#f59e0b");
          }
        } else if (m.mode === "angle" && projected.length === 3) {
          const [p1, p2, p3] = projected;
          if (p1.visible && p2.visible && p3.visible) {
            // Two lines: p1-p2 and p2-p3.
            drawLine(ctx, p1.x, p1.y, p2.x, p2.y, "#8b5cf6", 2.5, false);
            drawLine(ctx, p2.x, p2.y, p3.x, p3.y, "#8b5cf6", 2.5, false);
            // Spheres.
            drawSphere(ctx, p1.x, p1.y, 6, "#ef4444");
            drawSphere(ctx, p2.x, p2.y, 6, "#ef4444");
            drawSphere(ctx, p3.x, p3.y, 6, "#ef4444");
            // Label at vertex (p2).
            drawLabel(ctx, m.label, p2.x, p2.y - 15, "#8b5cf6");
          }
        }
      }

      // Draw interaction lines (from water-bridge / disulfide / metal charts).
      for (const line of interactionLines) {
        const p1 = project3DTo2D([line.from.x, line.from.y, line.from.z], pv, viewport);
        const p2 = project3DTo2D([line.to.x, line.to.y, line.to.z], pv, viewport);
        if (p1.visible && p2.visible) {
          // Line (dashed if specified).
          drawLine(ctx, p1.x, p1.y, p2.x, p2.y, line.color, 2.5, line.dashed ?? false);
          // Small spheres at endpoints.
          drawSphere(ctx, p1.x, p1.y, 4, line.color);
          drawSphere(ctx, p2.x, p2.y, 4, line.color);
          // Label at midpoint (if provided).
          if (line.label) {
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            drawLabel(ctx, line.label, midX, midY, line.color);
          }
        }
      }

      // Draw pending atoms (not yet enough for a complete measurement).
      const pending = pendingState.atoms;
      if (pending.length > 0) {
        for (let i = 0; i < pending.length; i++) {
          const atom = pending[i];
          const p = project3DTo2D([atom.x, atom.y, atom.z], pv, viewport);
          if (p.visible) {
            // Sphere.
            drawSphere(ctx, p.x, p.y, 7, "#ef4444");
            // Count label.
            drawLabel(
              ctx,
              `#${i + 1}`,
              p.x,
              p.y - 18,
              "#ef4444"
            );
          }
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [measurements, interactionLines, measureMode, viewer]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
