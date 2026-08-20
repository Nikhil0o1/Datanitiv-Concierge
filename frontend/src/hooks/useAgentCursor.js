import { useCallback, useRef, useState } from 'react';

const CURSOR_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M4 3l14 14-5.5 1.5L10 22 4 3z" fill="#1C1B18" stroke="#fff" stroke-width="1.2"/></svg>`;

export function useAgentCursor(workspaceRef, { wait, getSpeed = () => 1 } = {}) {
  const [cursorOn, setCursorOn] = useState(false);
  const [transform, setTransform] = useState('translate(50px, 50px)');
  const [transitionSec, setTransitionSec] = useState(0.82);
  const posRef = useRef({ x: 50, y: 50 });

  const show = useCallback(() => setCursorOn(true), []);
  const hide = useCallback(() => setCursorOn(false), []);

  const moveTo = useCallback(
    async (selector) => {
      const root = workspaceRef.current;
      if (!root) return null;
      const el = root.querySelector(selector);
      if (!el) return null;

      setCursorOn(true);
      const wsRect = root.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const x = rect.left - wsRect.left + rect.width / 2 - 11;
      const y = rect.top - wsRect.top + rect.height / 2 - 11;
      const speed = getSpeed() || 1;
      setTransitionSec(0.82 / speed);
      posRef.current = { x, y };
      setTransform(`translate(${x}px, ${y}px)`);
      el.classList.add('aim');
      await wait(760 / speed);
      return el;
    },
    [workspaceRef, wait, getSpeed],
  );

  const ripple = useCallback(() => {
    const root = workspaceRef.current;
    if (!root) return;
    const { x, y } = posRef.current;
    const rip = document.createElement('div');
    rip.className = 'rip';
    rip.style.left = `${x + 11}px`;
    rip.style.top = `${y + 11}px`;
    root.appendChild(rip);
    setTimeout(() => rip.remove(), 660);
  }, [workspaceRef]);

  const tap = useCallback(
    async (selector, onFire) => {
      const el = await moveTo(selector);
      if (!el) return false;
      ripple();
      await wait(135);
      el.classList.remove('aim');
      if (onFire) onFire(el);
      await wait(190);
      return true;
    },
    [moveTo, ripple, wait],
  );

  return {
    cursorOn,
    transform,
    transitionSec,
    svg: CURSOR_SVG,
    show,
    hide,
    moveTo,
    tap,
    ripple,
  };
}
