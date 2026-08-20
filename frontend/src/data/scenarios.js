/** Scenario definitions — step labels match prototype */
export const SCENARIOS = [
  { t: 'The morning brief', s: '83 screens → 3 decisions', key: 'brief' },
  { t: 'Filter by organisation', s: 'Program, then straight into the plan', key: 'filter' },
  { t: 'Peek every tab', s: 'Nothing is hidden from you', key: 'peek' },
  { t: 'Adjust by voice', s: 'One cell is wrong — say a number, it redraws', key: 'voice' },
  { t: 'Take the mouse', s: 'It steps aside, you drive', key: 'mouse' },
  { t: 'Approve every item', s: 'Nothing posts until you tick it', key: 'approve' },
  { t: 'The hours back', s: '24 down to 2, itemised', key: 'ledger' },
];

export function buildScenarioSteps(key, A) {
  const steps = {
    brief: [
      { l: 'Vera opens', f: () => A.ast('Standing by').then(() => A.wait(400)) },
      { l: 'Unprompted', f: () => A.say('Morning. I read all eleven plans at six. Eight of them need nothing from you today.') },
      {
        l: 'Reads the portfolio',
        f: () =>
          A.push('a', 'Agent · action', '11 plans · 83 steps read · triaged by what changes a decision')
            .then(() => A.addTime(750, 'reading 83 screens'))
            .then(() => A.reveal('dec'))
            .then(() => A.setCount('c1', '3 plans')),
      },
      {
        l: 'Names them',
        f: () =>
          A.say(
            'Three need a decision, across two programs. CP FTE Based is genuinely short today. Two more look fine this week and go badly negative by late September.',
          ),
      },
      {
        l: 'Shows autopilot set',
        f: () => A.reveal('auto').then(() => A.setCount('c2', '4 plans')),
      },
      { l: 'Folds the rest', f: () => A.showFold() },
      {
        l: 'The point',
        f: () =>
          A.say(
            'Four more only need a shrinkage correction under rules you gave me. The last four are folded, not hidden — open them whenever you like.',
          ),
      },
      {
        l: 'Complete',
        f: () =>
          A.say('That is eighty-three screens down to three questions. Where do you want to start?').then(() =>
            A.hideCursor(),
          ),
      },
    ],
    filter: [
      { l: 'Listening', f: () => A.hear(1100) },
      { l: 'You ask', f: () => A.push('u', 'Planner · voice', 'Just show me ACE Retail.', true) },
      {
        l: 'Filters',
        f: () => A.setFilter('ACE Retail').then(() => A.push('a', 'Agent · action', 'filtered · program = ACE Retail')),
      },
      {
        l: 'Vera on the cut',
        f: () => A.say('ACE Retail is eight plans, net over-under plus sixty-eight point six six. Two of them need you.'),
      },
      { l: 'Back to all', f: () => A.setFilter('all').then(() => A.push('a', 'Agent · action', 'filter cleared · 11 of 11')) },
      {
        l: 'Opens the worst',
        f: () =>
          A.openPlan('CAP00010').then(() => A.push('a', 'Agent · action', 'opened CAP00010 · CP FTE Based')),
      },
      { l: 'Marks the tabs', f: () => A.markTabs(['ov', 'nh', 'shr', 'rec']) },
      {
        l: 'Explains',
        f: () =>
          A.say(
            'Seven tabs, all of them open. I have marked the four that change your answer — overview, new hire, shrinkage, recommend.',
          ),
      },
      {
        l: 'Draws the position',
        f: () => A.drawOUChart('CAP00010', { mark: 8, lbl: 'w/c 09/27' }),
      },
      {
        l: 'Complete',
        f: () =>
          A.say('Flat until late September, then minus twenty-two FTE and it stays there.').then(() => A.hideCursor()),
      },
    ],
    peek: [
      {
        l: 'Sets up',
        f: () =>
          A.view('plan')
            .then(() => A.markTabs(['ov', 'nh', 'shr', 'rec']))
            .then(() => A.drawOUChart('CAP00010', { mark: 8, lbl: 'w/c 09/27' })),
      },
      { l: 'Listening', f: () => A.hear(1100) },
      { l: 'You ask', f: () => A.push('u', 'Planner · voice', 'Show me the ones you skipped.', true) },
      { l: 'Opens headcount', f: () => A.openTab('hc').then(() => A.push('a', 'Agent · action', 'opened Headcount · step 2')) },
      {
        l: 'Reads it',
        f: () =>
          A.say('Headcount. Opening fifty, closing fifty. The only movement all week is two point three eight coming out of nesting.'),
      },
      { l: 'Opens attrition', f: () => A.openTab('att').then(() => A.push('a', 'Agent · action', 'opened Attrition · step 5')) },
      {
        l: 'Reads it',
        f: () => A.say('Attrition. Zero actual, zero planned, right across the window. Nothing to adjust.'),
      },
      { l: 'Back to the roster', f: () => A.openTab('nh').then(() => A.push('a', 'Agent · action', 'opened New Hire · step 3')) },
      {
        l: 'The catch',
        f: () =>
          A.say(
            'This one I did keep. A class ran on the nineteenth and two point four two trained heads never made it onto the roster, so the plan cannot see them.',
          ),
      },
      {
        l: 'Maps it',
        f: () =>
          A.mapRoster('CAP00010').then(() => A.addTime(135, 'roster reconciliation, 9 classes')),
      },
      {
        l: 'Complete',
        f: () =>
          A.say(
            'Your real gap is six point six eight, not nine point one. Nine roster gaps across the portfolio are hiding ninety-three FTE.',
          ).then(() => A.hideCursor()),
      },
    ],
    voice: [
      {
        l: 'Sets up',
        f: () =>
          A.view('plan')
            .then(() => A.markTabs(['ov', 'nh', 'shr', 'rec']))
            .then(() => A.drawOUChart('CAP00010', { mark: 8, lbl: 'w/c 09/27' }))
            .then(() => A.openTab('shr'))
            .then(() => A.drawShrChart('CAP00010'))
            .then(() => A.buildEditor('CAP00010')),
      },
      {
        l: 'Finds the anomaly',
        f: () =>
          A.push('a', 'Agent · check', '09/20 planned at 6.0% · neighbouring weeks 49-51% · flagged as inconsistent').then(
            () => A.wait(400),
          ),
      },
      {
        l: 'Names it',
        f: () =>
          A.say(
            'Before you change anything — one cell here is wrong. The week of the twentieth is planned at six percent shrinkage. Every week around it is forty-nine.',
          ),
      },
      {
        l: 'Why it matters',
        f: () =>
          A.say(
            'That single cell makes that week read minus six FTE when it should read about minus forty. Your last eight weeks actually ran forty-three point one one.',
          ),
      },
      { l: 'Listening', f: () => A.hear(1200) },
      {
        l: 'You ask',
        f: () =>
          A.push('u', 'Planner · voice', 'Set all five forward weeks to the eight-week actual.', true),
      },
      {
        l: 'Applies it',
        f: () =>
          A.push('a', 'Agent · action', '5 weeks set to 43.11% · requirement recalculated live').then(() =>
            A.voiceSet([
              [0, 43.11],
              [1, 43.11],
              [2, 43.11],
              [3, 43.11],
              [4, 43.11],
            ]),
          ),
      },
      {
        l: 'Reads the impact',
        f: () =>
          A.say(
            'Two things happened. The twentieth got much worse and much more honest. And the other four were over-planned, so requirement across all five actually falls by eleven point nine FTE.',
          ),
      },
      { l: 'Listening', f: () => A.hear(1100) },
      {
        l: 'You refine',
        f: () =>
          A.push('u', 'Planner · voice', 'Hold the last two at forty-five. I do not trust that drop in October.', true),
      },
      {
        l: 'Refines it',
        f: () =>
          A.push('a', 'Agent · action', '10/11 and 10/18 held at 45.0% · net change now -5.83 FTE').then(() =>
            A.voiceSet([
              [3, 45],
              [4, 45],
            ]),
          ),
      },
      {
        l: 'Submits',
        f: () =>
          A.submitShrinkage('CAP00010').then(() => A.addTime(160, 'shrinkage variance review')),
      },
      {
        l: 'Complete',
        f: () =>
          A.say(
            'Submitted. Same formula the platform uses — requirement is billable over one minus shrinkage. You can see every number change as I say it.',
          ).then(() => A.hideCursor()),
      },
    ],
    mouse: [
      {
        l: 'Sets up',
        f: () =>
          A.view('plan')
            .then(() => A.markTabs(['ov', 'nh', 'shr', 'rec']))
            .then(() => A.drawOUChart('CAP00010', { mark: 8, lbl: 'w/c 09/27' }))
            .then(() => A.openTab('shr'))
            .then(() => A.drawShrChart('CAP00010'))
            .then(() => A.buildEditor('CAP00010')),
      },
      { l: 'Listening', f: () => A.hear(1100) },
      { l: 'You ask', f: () => A.push('u', 'Planner · voice', 'Let me do this bit myself.', true) },
      {
        l: 'Hands over',
        f: () =>
          A.say('All yours. Drag the sliders or type the numbers — I will keep the requirement and the chart in step.')
            .then(() => A.human(true))
            .then(() => A.push('s', 'Control', 'handed to planner · agent watching, not acting')),
      },
      {
        l: 'You are driving',
        f: () =>
          A.push('s', 'Try it', 'sliders below are live — drag one and the Overview chart redraws').then(() => A.wait(600)),
      },
      {
        l: 'Nudges',
        f: () =>
          A.say('Every tab and every control on the left is yours now. I am still reading, I am just not touching anything.'),
      },
      {
        l: 'Takes it back',
        f: () => A.human(false).then(() => A.push('s', 'Control', 'returned to agent')),
      },
      {
        l: 'Complete',
        f: () => A.say('Say the word any time and I will step aside again.').then(() => A.hideCursor()),
      },
    ],
    approve: [
      {
        l: 'Opens the queue',
        f: () => A.view('queue').then(() => A.reveal('pkg')),
      },
      {
        l: 'Explains',
        f: () =>
          A.say('Four packages are queued. Two cost nothing — they are shrinkage corrections. Two spend something.'),
      },
      {
        l: 'Ticks the free ones',
        f: () =>
          A.tickPackage('CAP00018').then(() => A.tickPackage('CAP00022')),
      },
      {
        l: 'The spend items',
        f: () =>
          A.say(
            'These two need you specifically. Six point six eight FTE loaned between programs, and eighty hours of overtime on FTE for coverage.',
          ),
      },
      { l: 'Listening', f: () => A.hear(1200) },
      {
        l: 'You approve all',
        f: () => A.push('u', 'Planner · voice', 'Approve all four. Execute.', true),
      },
      { l: 'Selects all', f: () => A.selectAllPackages() },
      {
        l: 'Executes',
        f: () => A.executeSelected().then(() => A.addTime(65, 'building the execution queue')),
      },
      {
        l: 'Complete',
        f: () =>
          A.say(
            'Posted. Eighty hours of overtime, one cross-program loan, no requisitions. Both planners notified and you can undo any of it for twenty-four hours.',
          ).then(() => A.hideCursor()),
      },
    ],
    ledger: [
      { l: 'Opens the ledger', f: () => A.view('time').then(() => A.wait(300)) },
      {
        l: 'Vera opens',
        f: () => A.say('You asked what this actually saves. Here it is, line by line, for this cycle.'),
      },
      { l: 'Fills it in', f: () => A.fillLedger() },
      {
        l: 'Reads the total',
        f: () =>
          A.say('Twenty-one hours and fifty minutes absorbed. Two hours and ten minutes left, and all of it is decisions.'),
      },
      {
        l: 'Where it came from',
        f: () =>
          A.say(
            'The biggest single line is reading. Twelve and a half hours of opening plans and scanning weeks, and none of it was judgement.',
          ),
      },
      {
        l: 'Cites the rules',
        f: () => A.citeMemories().then(() => A.push('a', 'Agent · recall', '3 standing rules applied today · all from your corrections')),
      },
      {
        l: 'The honest bit',
        f: () =>
          A.say(
            'Nobody told me to check rosters before recommending overtime. You did, in June, once. That one rule is most of what made today different.',
          ),
      },
      {
        l: 'Complete',
        f: () =>
          A.say('The reading moved to me. The approvals never left you — and if a rule stops being true, delete it.').then(
            () => A.hideCursor(),
          ),
      },
    ],
  };
  return steps[key] || [];
}
