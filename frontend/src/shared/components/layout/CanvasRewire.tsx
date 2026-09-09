import { useEffect, useRef, useCallback } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulsePhase: number;
  pulseSpeed: number;
  energy: number;
}

interface Pulse {
  fromNode: number;
  toNode: number;
  progress: number;
  speed: number;
  opacity: number;
}

interface MouseState {
  x: number;
  y: number;
  active: boolean;
}

/** Electrical rewiring network background animation, sensitive to mouse position */
export const ElectricalNetworkBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const nodesRef = useRef<Node[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const mouseRef = useRef<MouseState>({ x: 0, y: 0, active: false });
  const timeRef = useRef<number>(0);

  const NODE_COUNT = 48;
  const CONNECTION_RADIUS = 180;
  const MOUSE_INFLUENCE_RADIUS = 220;
  const PULSE_SPAWN_CHANCE = 0.012;

  const initNodes = useCallback((width: number, height: number) => {
    nodesRef.current = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      radius: Math.random() * 1.8 + 0.8,
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: Math.random() * 0.02 + 0.008,
      energy: Math.random(),
    }));
  }, []);

  const getConnectionStrength = useCallback(
    (a: Node, b: Node, mouse: MouseState): number => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > CONNECTION_RADIUS) return 0;

      let strength = 1 - dist / CONNECTION_RADIUS;

      if (mouse.active) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const mdx = midX - mouse.x;
        const mdy = midY - mouse.y;
        const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mouseDist < MOUSE_INFLUENCE_RADIUS) {
          strength *= 1 + (1 - mouseDist / MOUSE_INFLUENCE_RADIUS) * 2.8;
        }
      }

      return Math.min(strength, 1);
    },
    []
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const nodes = nodesRef.current;
    const pulses = pulsesRef.current;
    const mouse = mouseRef.current;
    const time = (timeRef.current += 0.016);

    ctx.clearRect(0, 0, width, height);

    // Update node positions
    nodes.forEach((node) => {
      node.pulsePhase += node.pulseSpeed;
      node.x += node.vx;
      node.y += node.vy;

      // Mouse repulsion / attraction
      if (mouse.active) {
        const dx = node.x - mouse.x;
        const dy = node.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_INFLUENCE_RADIUS && dist > 0) {
          const force = ((MOUSE_INFLUENCE_RADIUS - dist) / MOUSE_INFLUENCE_RADIUS) * 0.015;
          node.vx += (dx / dist) * force;
          node.vy += (dy / dist) * force;
        }
      }

      // Damping
      node.vx *= 0.992;
      node.vy *= 0.992;

      // Speed floor
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed < 0.1) {
        node.vx += (Math.random() - 0.5) * 0.04;
        node.vy += (Math.random() - 0.5) * 0.04;
      }

      // Boundary wrap
      if (node.x < -20) node.x = width + 20;
      if (node.x > width + 20) node.x = -20;
      if (node.y < -20) node.y = height + 20;
      if (node.y > height + 20) node.y = -20;
    });

    // Draw connections
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const strength = getConnectionStrength(nodes[i], nodes[j], mouse);
        if (strength <= 0) continue;

        const baseOpacity = strength * 0.18;
        const flicker = 0.92 + Math.sin(time * 3.1 + i * 0.7 + j * 1.3) * 0.08;
        const opacity = baseOpacity * flicker;

        // Main wire line
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);

        const gradient = ctx.createLinearGradient(
          nodes[i].x, nodes[i].y,
          nodes[j].x, nodes[j].y
        );
        gradient.addColorStop(0, `rgba(56, 189, 248, ${opacity})`);
        gradient.addColorStop(0.5, `rgba(99, 240, 180, ${opacity * 1.3})`);
        gradient.addColorStop(1, `rgba(56, 189, 248, ${opacity})`);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = strength * 0.9 + 0.2;
        ctx.stroke();

        // Glow layer for strong connections
        if (strength > 0.45) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(99, 240, 180, ${opacity * 0.22})`;
          ctx.lineWidth = strength * 4;
          ctx.stroke();
        }

        // Spawn pulses along strong connections
        if (strength > 0.3 && Math.random() < PULSE_SPAWN_CHANCE * strength) {
          pulses.push({
            fromNode: i,
            toNode: j,
            progress: 0,
            speed: Math.random() * 0.018 + 0.008,
            opacity: strength * 0.9,
          });
        }
      }
    }

    // Draw & update pulses
    pulsesRef.current = pulses.filter((pulse) => {
      pulse.progress += pulse.speed;
      if (pulse.progress >= 1) return false;

      const from = nodes[pulse.fromNode];
      const to = nodes[pulse.toNode];
      if (!from || !to) return false;

      const px = from.x + (to.x - from.x) * pulse.progress;
      const py = from.y + (to.y - from.y) * pulse.progress;

      // Pulse glow
      const grd = ctx.createRadialGradient(px, py, 0, px, py, 7);
      grd.addColorStop(0, `rgba(180, 255, 220, ${pulse.opacity * 0.95})`);
      grd.addColorStop(0.4, `rgba(56, 189, 248, ${pulse.opacity * 0.5})`);
      grd.addColorStop(1, `rgba(56, 189, 248, 0)`);

      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Pulse core dot
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220, 255, 240, ${pulse.opacity})`;
      ctx.fill();

      return true;
    });

    // Draw nodes
    nodes.forEach((node, i) => {
      const pulse = Math.sin(node.pulsePhase) * 0.5 + 0.5;

      // Mouse proximity boost
      let boost = 1;
      if (mouse.active) {
        const dx = node.x - mouse.x;
        const dy = node.y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_INFLUENCE_RADIUS) {
          boost = 1 + (1 - dist / MOUSE_INFLUENCE_RADIUS) * 2.2;
        }
      }

      const glowRadius = (node.radius + pulse * 2.5) * boost;
      const coreOpacity = (0.5 + pulse * 0.5) * Math.min(boost, 1.8);

      // Node glow
      const grd = ctx.createRadialGradient(
        node.x, node.y, 0,
        node.x, node.y, glowRadius * 4.5
      );
      grd.addColorStop(0, `rgba(99, 240, 180, ${coreOpacity * 0.55})`);
      grd.addColorStop(0.5, `rgba(56, 189, 248, ${coreOpacity * 0.18})`);
      grd.addColorStop(1, `rgba(56, 189, 248, 0)`);

      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius * 4.5, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Node core
      ctx.beginPath();
      ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(180, 255, 230, ${coreOpacity * 0.85})`;
      ctx.fill();

      // Occasional spark cross on high-energy nodes
      if (boost > 1.8 || (pulse > 0.88 && i % 7 === 0)) {
        const sparkLen = glowRadius * 3.5;
        ctx.strokeStyle = `rgba(200, 255, 240, ${coreOpacity * 0.6})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(node.x - sparkLen, node.y);
        ctx.lineTo(node.x + sparkLen, node.y);
        ctx.moveTo(node.x, node.y - sparkLen);
        ctx.lineTo(node.x, node.y + sparkLen);
        ctx.stroke();
      }
    });

    animationRef.current = requestAnimationFrame(draw);
  }, [getConnectionStrength]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initNodes(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
    };
    const onMouseLeave = () => {
      mouseRef.current.active = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      mouseRef.current = { x: t.clientX, y: t.clientY, active: true };
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onMouseLeave);

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onMouseLeave);
    };
  }, [draw, initNodes]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
};

//export default ElectricalNetworkBackground;