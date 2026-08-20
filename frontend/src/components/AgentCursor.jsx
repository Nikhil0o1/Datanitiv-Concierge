export default function AgentCursor({ cursor }) {
  if (!cursor) return null;
  return (
    <div
      className={`cur ${cursor.cursorOn ? 'on' : ''}`}
      id="cur"
      aria-hidden
      style={{
        transform: cursor.transform,
        transitionDuration: `${cursor.transitionSec}s`,
      }}
      dangerouslySetInnerHTML={{ __html: cursor.svg }}
    />
  );
}
