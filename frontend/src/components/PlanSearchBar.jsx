import { useEffect, useId, useRef, useState } from 'react';
import { normalizeSearchQuery, searchPlans } from '../utils/planSearch';

export default function PlanSearchBar({
  plans = [],
  program = 'all',
  value = '',
  onChange,
  onOpenPlan,
  onSearchSubmit,
  showing = 0,
  total = 0,
}) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef(null);
  const listId = useId();

  const q = normalizeSearchQuery(value);
  const suggestions = q ? searchPlans(plans, value, { program, limit: 8 }) : [];

  useEffect(() => {
    setActiveIdx(-1);
  }, [value, program]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (plan) => {
    onOpenPlan?.(plan.capId);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (value) {
        onChange?.('');
        e.preventDefault();
      }
      setOpen(false);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!suggestions.length) return;
      setOpen(true);
      setActiveIdx((i) => (i + 1) % suggestions.length);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!suggestions.length) return;
      setOpen(true);
      setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIdx >= 0 && suggestions[activeIdx]) {
        pick(suggestions[activeIdx]);
        return;
      }
      const top = suggestions[0];
      if (top) {
        pick(top);
        return;
      }
      onSearchSubmit?.(value);
    }
  };

  return (
    <div className={`plan-search ${open && q ? 'open' : ''}`} ref={wrapRef}>
      <div className="plan-search-field">
        <span className="plan-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          className="srch"
          placeholder="Search CAP ID, plan, site, planner…"
          value={value}
          onChange={(e) => {
            onChange?.(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(Boolean(q))}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search plans"
        />
        {value ? (
          <button
            type="button"
            className="plan-search-clear"
            onClick={() => {
              onChange?.('');
              setOpen(false);
            }}
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>

      {open && q && suggestions.length ? (
        <ul className="plan-search-results" id={listId} role="listbox">
          {suggestions.map((p, i) => (
            <li key={p.capId} role="option" aria-selected={i === activeIdx}>
              <button
                type="button"
                className={`plan-search-hit ${i === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(p)}
              >
                <span className="capchip">{p.capId}</span>
                <span className="plan-search-hit-name">{p.plan}</span>
                <span className="plan-search-hit-meta">{p.program}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {open && q && !suggestions.length ? (
        <div className="plan-search-empty">No plans match “{value.trim()}”</div>
      ) : null}

      <span className="showing" id="showing">
        Showing {showing} of {total}
        {q ? ` · “${value.trim()}”` : ''}
      </span>
    </div>
  );
}
