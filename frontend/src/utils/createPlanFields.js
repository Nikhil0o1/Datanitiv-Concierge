/** Field order for Vera-guided CAP plan creation. */
export const CREATE_PLAN_FIELDS = [
  {
    key: 'program',
    label: 'Organization',
    placeholder: 'ACE Retail',
    optionsKey: 'programs',
  },
  { key: 'planName', label: 'Plan name', placeholder: '2027 Customer Support CAP' },
  { key: 'site', label: 'Site', placeholder: 'Hyderabad' },
  { key: 'lob', label: 'Line of business', placeholder: 'Customer Support' },
  { key: 'skill', label: 'Skill / queue', placeholder: 'Premium Support' },
  { key: 'channel', label: 'Channel', placeholder: 'Voice' },
  { key: 'planningPeriod', label: 'Planning period', placeholder: 'Jan–Dec 2027' },
  {
    key: 'scenario',
    label: 'Scenario',
    placeholder: 'Base',
    options: ['Base', 'Optimistic', 'Conservative'],
  },
];

export const CREATE_PLAN_SELECT_KEYS = new Set(['program', 'scenario']);

export const EMPTY_CREATE_PLAN_DRAFT = () =>
  Object.fromEntries(CREATE_PLAN_FIELDS.map((f) => [f.key, '']));

export function nextCreatePlanField(draft) {
  return CREATE_PLAN_FIELDS.find((f) => !String(draft?.[f.key] || '').trim())?.key || null;
}

export function createPlanPayload(draft) {
  return {
    plan_name: draft.planName?.trim(),
    site: draft.site?.trim(),
    lob: draft.lob?.trim(),
    skill: draft.skill?.trim() || null,
    channel: draft.channel?.trim() || null,
    planning_period: draft.planningPeriod?.trim() || null,
    scenario: draft.scenario?.trim() || 'Base',
    program: draft.program?.trim() || null,
  };
}

export function apiFieldToDraftKey(field) {
  const map = {
    plan_name: 'planName',
    planName: 'planName',
    program: 'program',
    site: 'site',
    lob: 'lob',
    skill: 'skill',
    channel: 'channel',
    planning_period: 'planningPeriod',
    planningPeriod: 'planningPeriod',
    scenario: 'scenario',
  };
  return map[field] || field;
}

export function isCreatePlanSelectKey(key) {
  return CREATE_PLAN_SELECT_KEYS.has(key);
}
