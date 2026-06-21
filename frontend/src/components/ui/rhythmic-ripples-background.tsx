import { useEffect, useRef, type ReactNode } from "react";

interface RhythmicRipplesBackgroundProps {
  children: ReactNode;
  backgroundColor?: string;
  rippleColor?: string;
  rippleCount?: number;
  rippleSpeed?: number;
}

export default function RhythmicRipplesBackground({
  children,
  backgroundColor = "#000000",
  rippleColor = "rgba(99, 91, 255, 0.64)",
  rippleCount = 30,
  rippleSpeed = 0.46,
}: RhythmicRipplesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const context = ctx;

    let ripples: Ripple[] = [];
    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    class Ripple {
      x = 0;
      y = 0;
      radius = 0;
      maxRadius = 0;
      speed = 0;

      constructor() {
        this.reset();
      }

      reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.radius = Math.random() * 32;
        this.maxRadius = Math.random() * 180 + 80;
        this.speed = Math.random() * rippleSpeed + 0.18;
      }

      update() {
        this.radius += this.speed;
        if (this.radius > this.maxRadius) this.reset();
      }

      draw() {
        const alpha = Math.max(0, 1 - this.radius / this.maxRadius);
        context.beginPath();
        context.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        context.strokeStyle = rippleColor.replace(/[\d.]+\)$/u, `${alpha * 0.74})`);
        context.lineWidth = 2.1;
        context.shadowBlur = 22;
        context.shadowColor = rippleColor.replace(/[\d.]+\)$/u, `${alpha * 0.42})`);
        context.stroke();
        context.shadowBlur = 0;
      }
    }

    const setup = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      ripples = Array.from({ length: rippleCount }, () => new Ripple());
    };

    const animate = () => {
      context.clearRect(0, 0, width, height);
      for (const ripple of ripples) {
        if (!reduceMotion) ripple.update();
        ripple.draw();
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    setup();
    animate();
    window.addEventListener("resize", setup);

    return () => {
      window.removeEventListener("resize", setup);
      cancelAnimationFrame(animationFrameId);
    };
  }, [rippleColor, rippleCount, rippleSpeed]);

  return (
    <div className="ripple-bg" style={{ backgroundColor }}>
      <canvas ref={canvasRef} className="ripple-canvas" aria-hidden="true" />
      <div className="ripple-content">{children}</div>
    </div>
  );
}
