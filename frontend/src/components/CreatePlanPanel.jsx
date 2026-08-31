import { CREATE_PLAN_FIELDS, nextCreatePlanField } from '../utils/createPlanFields';

export default function CreatePlanPanel({
  open,
  draft,
  onChange,
  onSubmit,
  onClose,
  busy,
  agentMode,
  highlightField,
  openSelect,
  error,
  programOptions = [],
}) {
  if (!open) return null;

  const next = nextCreatePlanField(draft);
  const orgOptions = programOptions.map((p) => (typeof p === 'string' ? p : p.name)).filter(Boolean);

  return (
    <div className="create-plan-backdrop" data-create-plan-panel role="dialog" aria-modal="true">
      <div className="card create-plan-card in">
        <div className="ch">
          <b>New CAP plan</b>
          <span className="tag">{agentMode ? 'Vera is filling this' : 'Organizational context'}</span>
        </div>
        <p className="create-plan-lede">
          {agentMode
            ? 'Answer Vera in the chat panel on the right — mic or type. She’ll fill each field here as you go.'
            : 'Set the plan context. Vera can also walk you through this step by step.'}
        </p>
        <div className="hc-edit create-plan-grid">
          {CREATE_PLAN_FIELDS.map((f) => {
            const val = draft[f.key] ?? '';
            const isNext = highlightField === f.key || (!highlightField && next === f.key);
            const options = f.optionsKey === 'programs' ? orgOptions : f.options;
            const menuOpen = agentMode && openSelect === f.key;
            return (
              <label
                key={f.key}
                className={`create-field ${isNext ? 'focus' : ''} ${val ? 'filled' : ''}`}
                data-create-field={f.key}
              >
                {f.label}
                {options && agentMode ? (
                  <div className={`create-select-wrap ${menuOpen ? 'open' : ''}`}>
                    <button
                      type="button"
                      className="create-select-trigger"
                      data-create-select-trigger={f.key}
                      tabIndex={-1}
                    >
                      {val || 'Select…'}
                      <span className="create-select-caret" aria-hidden>
                        ▾
                      </span>
                    </button>
                    {menuOpen ? (
                      <ul className="create-select-menu" role="listbox">
                        {options.map((o) => (
                          <li
                            key={o}
                            role="option"
                            className={val === o ? 'sel' : ''}
                            data-create-option={f.key}
                            data-option-value={o}
                          >
                            {o}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : options ? (
                  <select
                    value={val}
                    onChange={(e) => onChange?.(f.key, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={val}
                    readOnly={agentMode}
                    data-create-input={f.key}
                    placeholder={f.placeholder}
                    onChange={(e) => onChange?.(f.key, e.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
        {error ? (
          <div className="insight warn" style={{ marginTop: 10 }}>
            {error}
          </div>
        ) : null}
        {!agentMode ? (
          <div className="acts" style={{ marginTop: 12 }}>
            <button type="button" className="btn p" data-act="submit-create-plan" disabled={busy} onClick={onSubmit}>
              {busy ? 'Creating…' : 'Create plan'}
            </button>
            <button type="button" className="btn g" onClick={onClose}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="dragnote" style={{ marginTop: 10 }}>
            Next: <b>{next ? CREATE_PLAN_FIELDS.find((x) => x.key === next)?.label : 'Ready to create'}</b>
          </div>
        )}
      </div>
    </div>
  );
}
